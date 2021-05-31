# AOF Server Implementation
## Design Goals
- mostly portable
    - put everything required to run the server in the working directory
    - should be able to run on a subpath (e.g. reverse proxied)
- server only does strictly necessary tasks
    - do everything else on the client

### Users
- `name`: the user's name. can be changed but must be unique
- `password`: the user's password.
    - stored as a string `<base64-derived-key>$<base64-salt>` in the database
    - PBKDF2 SHA512, 64-byte DK, 32-byte salt, 150k iterations.
- `secret_key`: the user's secret key.
    - stored as a string `<base64-salt>$<base64-nonce+ciphertext>` in the database
    - Decryption:
        - Try login password, or prompt user for the secret key password.
        - Derive decryption key using PBKDF2 SHA512, 32-byte DK, 32-byte salt, 150k iterations.
        - Use DK to decrypt the ciphertext using AES-256-GCM.
        - Obtain secret key.
    - The secret key is a random 32-byte string.

### Tokens
Tokens are used as a rate-limiting mechanism. Each user-initiated HTTP request costs one token.

Tokens are replenished over time.

### Registration
Users can be registered using a *registration token* (an invite code), which may be any arbitrary string.
Tokens will expire after a set amount of time.
Tokens are stored in the `registration_tokens` table in the database and will be deleted eventually after expiring.

To create a token, run `insert into registration_tokens (token, date_created) values ('<token>', '<current time in iso8601>');`.

The registration API is located at `/api/registration`.

- `is_valid_token?token=<token>`
    - returns `true` or `false` (plain text)
- `is_name_available?token=<token>&name=<name>`
    - response is a JSON object
        - `available`: bool
        - if not available
            - `error`: string, one of:
                - `invalid_token`: invalid registration token
                - `name_taken`: name is taken
                - `invalid_name`: name contains a disallowed character or is too long
- POST `register`
    - JSON body
        - `token`: string token
        - `name`: string username
        - `password`: string in plain text
        - `secret_key`: string already derived
    - response is a JSON object
        - `success`: bool
        - `error`: string, present is success is false. May be one of:
            - `invalid_token`: invalid registration token
            - `name_taken`: name is taken
            - `invalid_name`: name is invalid
            - `password_too_long`: the password is too long

### Login
The login API is located at `/api/login`.
User sessions are stored in a cookie `aof_session`.

- GET `/api/login`
    - response is a JSON object
        - `auth`: bool whether there is a user session
        - if auth
            - `name`: string username
        - if error
            - `error`: string, one of:
                - `no_session`: there is no session
                - `internal_error`: internal error
- POST `/api/login`
    - JSON body
        - `name`: string username
        - `password`: string in plain text
        - `persist`: bool - if true, will create a persistent cookie
    - response is a JSON object
        - `success`: bool
        - if successful
            - (There will be a Set-Cookie header)
            - `secret_key`: string as stored on the server
        - if error
            - `error`: string. May be one of:
                - `invalid`: invalid username or password
                - `logged_in`: already logged in
                - `internal_error`: internal error
- DELETE `/api/login`
    - response is a JSON object
        - `success`: bool
        - if error
            - `error`: string. May be one of:
                - `no_session`: already logged out
                - `internal_error`: internal error
 
### RSS Proxy
Sources can be configured to generate RSS feeds.

- GET `/api/rss/<key>/source/<domain>/<path>`
    - response is RSS XML (empty if not loaded)

### Sources
#### Source Domains
Sources are referred to by a unique URI:

```
domain:///path/to/source/or/item
```

A domain, referred to by its unique id,
contains Javascript scripts for loading sources and items.
Standard browser APIs should be available.

Scripts must export the following interface:

```ts
type Source = {
    // see below for recommended tags
    tags: {
        canonical_url: string,
        authors: Author[],
        ...
    },
    last_updated: string | null,
    items: {
        // path that can be passed to loadSourceItem.
        // The domain will be prepended automatically.
        path: string,
        // if true, this source item will not be fetched automatically
        virtual?: boolean,
        // preliminary tags. Should only include a bit of metadata, such as the title.
        tags?: {
            title: string,
            ...
        },
    }[],
    // if available, item data can be provided here directly.
    // will be ignored if the path is not in `items`
    item_data?: { [path: string]: SourceItem },
};

type SourceItem = {
    last_updated: string | null,
    // see below for recommended tags
    tags: {
        canonical_url: string,
        preface: { [k: string]: string },
        contents: string,
        ...
    },
};

export {
    loadSource: (path: string) => Promise<Source>,
    loadSourceItem: (path: string) => Promise<SourceItem>,
};
```

This script will be run in V8 for six seconds at most, after which they will be aborted.
Time spent on fetches is not counted against the runtime limit.

#### Source Data
Sources may have tagged metadata.

##### Recommended Tags
- `title`: `string` - the title
- `canonical_url`: `string` - the canonical URL (http)
- `authors`: `Author[]` - list of authors
    - `Author`: map with `name`: string, `url`: string?
- `completion`: `Completion` - completion state
    - `Completion`: map with `total`: number?
        - a source is considered complete when its number of items is the total number of items
- `content_tags`: `map<string, ContentTag[]>` - lists of tags per tag category
    - `ContentTag`: map with `name`: string, `url`: string?
- `description`: `map<string, string>` - tagged description

#### Source Items
Source items contain tagged data which is stored gzipped in the database.

##### Recommended Tags
- `canonical_url`: `string` - the canonical URL (http)
- `preface`: a short section of tagged data that should be shown before the actual contents of this item
    - should be a `map<string, string>` (ordered!) containing various preface items
    - contents are interpreted as HTML
- `contents`: `string` - HTML contents
- `appendix`: same as preface, but at the end

#### User Data
Sources and source items may have user data associated with them.
This data is encrypted using AES-256 GCM and the user's secret key.
It should be a msgpack map containing tagged data.

A single user data node may be at most 16384 bytes in size (when encrypted).

##### Recommended Tags for Sources
- `category`: `string` for grouping multiple sources together
- `content_tags`: `string[]` arbitrary user tags
- `notes`: `string` arbitrary user notes
- `read`: `map<string, ReadState>` - maps source item *paths* to read state
    - `ReadState`:
        - `read`: `bool` true if item was read completely
        - `read_until`: `string` optional, for tracking “partially read” state using a tag referring to a position in the item’s contents

##### Recommended Tags for Source Items
- `notes`: `string` arbitrary user notes

### Web Sockets API
Most application data is exchanged over web sockets.
The endpoint is located at `/api/session`.
To establish a successful connection, the session cookie should be present.

#### Protocol
Any protocol error will result in the connection being terminated.

- All messages are binary messages.
- A single message cannot be larger than 16384 bytes.
- All strings are utf-8 encoded.

##### Request-Response
Requests are sent from the client and the server will send a response.
Requests are tagged using a 32-bit integer (may be sequential). The request id must be unique for as long as the request has not been completed.

A request is structured as follows:

- `c0` byte signifying a request
- 4 bytes request id
- 1 byte request name length
- var bytes request name
- an optional msgpack map with parameters

The first response message is structured as follows:

- `c8` byte signifying a response
- 4 bytes request id
- 4 bytes response length (big endian)
- a msgpack value. May be partial data

If the msgpack value length is smaller than the response length, this will be followed by additional response messages:

- `c9` byte signifying a response continuation
- 4 bytes request id
- a continuation of the partial msgpack value

If the server has encountered an unexpected error while fulfilling the request, the following message will be sent:

- `cc`: byte signifying an error response
- 4 bytes request id

This message may occur even after partial data was sent (though this should generally not happen).

##### Events
Events are always a single message notifying the client of a change of some sort.

An event is structured as follows:

- `b8` byte signifying an event
- 1 byte event name length
- var bytes event name
- an optional msgpack map with additional data

#### Requests
##### `user_client_key`
No parameters. Returns a random byte array that is always the same.

##### `user_secret_key`
No parameters. Returns the secret key as a string.

##### `user_tokens`
No parameters. Returns the number of tokens as a number.

##### `user_change_name`
Parameters:
- `new_name`: string - the new name

Returns a map:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `name_taken`
        - `invalid_name`
        - `internal_error`

##### `user_change_password`
Parameters:
- `password`: string - current password
- `new_password`: string - new password

Returns a map:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `invalid`: invalid password
        - `internal_error`

##### `user_change_secret_key`
Parameters:
- `password`: string - login password
- `new_secret_key`: string - the new derived secret key string

Returns a map:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `invalid`: invalid password
        - `internal_error`

##### `user_delete`
Parameters:
- `password`: string

Returns a map:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `invalid`: invalid password
        - `internal_error`

##### `user_regen_client_key`
No parameters. Generates a new client key. Returns nothing.

##### `user_enumerate_objects`
No parameters.

Returns all objects associated with the user, as an array of maps:

- `type`: `source`
    - `uri`: string
    - `version`: string
- `type`: `source_item`
    - `uri`: string
    - `version`: string
- `type`: `source_user_data`
    - `uri`: string
    - `size`: number
- `type`: `source_item_user_data`
    - `uri`: string
    - `size`: number
- `type`: `domain`
    - `id`: string

##### `user_sources`
No parameters.

Returns the URI of all sources the user is subscribed to as a string array.

##### `source`
Parameters:
- `uri`: string - the URI of the source

Returns a map:
- `loaded`: bool
- `data`: exists if loaded:
    - `last_fetched`: string (ISO8601 date time)
    - `last_updated`: nullable string (ISO8601 date + optional time)
    - `data`: `map<string, any>` tagged metadata
    - `items`: Item[] list of source items
        - Item is a map of:
            - `uri`: string uri of this item
            - `data`: `map<string, any>` tagged metadata

##### `source_item`
Parameters:
- `uri`: string - the URI of the source item

Returns a map:
- `loaded`: bool
- `data`: exists if loaded:
    - `last_fetched`: string (ISO8601 date time)
    - `last_updated`: nullable string (ISO8601 date + optional time)

##### `source_item_data`
Parameters:
- `uri`: string - the URI of the source item

Returns either null if it's not loaded or a map containing tagged data.

##### `source_user_data`
Parameters:
- `uri`: string - the URI of the source

Returns either zero bytes, or a binary blob of encrypted user data.

##### `source_item_user_data`
Parameters:
- `uri`: string - the URI of the source item

Returns either zero bytes, or a binary blob of encrypted user data.

##### `user_subscribe_source`
Parameters:
- `uri`: string

Adds the source to the user’s subscriptions. This will emit an event.

Returns:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `already_subscribed`
        - `invalid_uri`

##### `user_unsubscribe_source`
Parameters:
- `uri`: string

Removes the source from the user’s subscriptions. This will emit an event.
Does not delete user data.

Returns:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `not_subscribed`
        - `invalid_uri`
 
##### `user_delete_source`
Parameters:
- `uri`: string

Deletes all user data associated with this source.
The source subsequently will appear to be unloaded.

Returns:
- `success`: bool
 
##### `user_request_source`
Parameters:
- `uri`: string

Requests for the source to be fetched.

Returns:
- `success`: bool - true if the request was received
- if not success:
    - `error`: string, one of:
        - `insufficient_tokens`
        - `invalid_uri`

##### `user_request_source_item`
Parameters:
- `uri`: string

Requests for the source item to be fetched.

Returns:
- `success`: bool - true if the request was received
- if not success:
    - `error`: string, one of:
        - `insufficient_tokens`
        - `invalid_uri`

##### `set_source_user_data`
Parameters:
- `uri`: string
- `data`: blob

This will emit an event on all other sessions.
User data can be deleted by sending zero bytes of data.

Returns:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `invalid_uri`

##### `set_source_item_user_data`
Parameters:
- `uri`: string
- `data`: blob

This will emit an event on all other sessions.
User data can be deleted by sending zero bytes of data.

Returns:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `invalid_uri`

##### `user_create_domain`
Parameters:
- `abbrev`: string - domain abbreviation, should be at most 6 characters
- `name`: string - the full name of this domain

Returns:
- `success`: bool
- `error`: string if not successful, one of:
    - `abbrev_too_short`
    - `abbrev_too_long`
    - `name_too_short`
    - `name_too_long`
- `id`: string - domain id, if successful

##### `user_update_domain`
Parameters:
- `id`: string
- `abbrev`: string
- `name`: string
- `description`: string
- `is_public`: bool
- `script`: string

Updates a domain. Emits an event if successful.

Returns:
- `success`: bool
- `error`: string if not successful, one of:
    - `not_found`: specified domain does not exist
    - `forbidden`: user does not have permission to update specified domain
    - `abbrev_too_short`
    - `abbrev_too_long`
    - `name_too_short`
    - `name_too_long`
    - `description_too_long`
    - `script_too_long`

##### `user_delete_domain`
Parameters:
- `id`: string

Deletes a domain. This will not delete loaded source data.

Returns:
- `success`: bool
- `error`: string if not successful, one of:
    - `not_found`
    - `forbidden`

##### `user_domains`
Returns an array of domain ids that the user either owns or is subscribed to.

##### `domain`
Parameters:
- `id`: string - domain id

Returns null if the domain does not exist, otherwise a map:
- `abbrev`: string
- `name`: string
- `description`: string
- `is_public`: bool
- `editable`: bool - true if the user is the owner

##### `domain_script`
Parameters:
- `id`: string - domain id

Returns a map:
- `success`: bool
- `script`: string if successful
- `error`: string if not successful, one of:
    - `not_found`

##### `user_subscribe_domain`
Parameters:
- `id`: string

Adds a domain to a user's domains list. The domain must not be owned by the user.

Returns:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `is_owner`
        - `already_subscribed`

##### `user_unsubscribe_domain`
Parameters:
- `id`: string

Removes a domain and all sources from that domain from a user's domains/sources lists,
but does not delete source user data. The domain must not be owned by the user.

Returns:
- `success`: bool
- if not success:
    - `error`: string, one of:
        - `is_owner`
        - `not_subscribed`

##### `public_domains`
Returns a list of ids of public domains.

##### `user_rss_auth_keys`
No parameters.
Returns all RSS authentication keys that belong to a user, as an array of objects with following
fields:

- `key`: string
- `label`: string or null

##### `user_create_rss_auth_key`
Parameters:
- `label`: string or null

Returns:
- `success`: bool
- `key`: string if successful

##### `user_delete_rss_auth_key`
Parameters:
- `key`: string

Returns:
- `success`: bool
- `error`: string if not successful. one of:
    - `not_found`

#### Events
##### `protocol_error`
Will be sent to the client right before the connection is closed due to a protocol error.

- `error`: string describing the error

##### `user_did_subscribe_source`
Will be sent to all sessions when a subscription is added.

- `source`: source id

##### `user_did_unsubscribe_source`
Will be sent to all sessions when a subscription is removed.

- `source`: source id

##### `user_did_subscribe_domain`
Will be sent to all sessions when a subscription is added.

- `domain`: domain id

##### `user_did_unsubscribe_domain`
Will be sent to all sessions when a subscription is removed.

- `domain`: domain id

##### `source_user_data_did_update`
Will be sent to all other sessions when user data is updated.

- `source`: source id

##### `source_item_user_data_did_update`
Will be sent to all other sessions when user data is updated.

- `source_item`: source item id

##### `subscribed_domain_did_update`
Will be sent to all sessions when the domain is updated.

- `domain`: source id
- `type`: string, one `update` or `delete`

##### `source_fetch_did_begin`
This event will always be followed by `source_fetch_did_end`.
It will be emitted for all subscribed sources and for user-initiated fetches.

- `source`: source id

##### `source_fetch_did_end`
- `source`: source id
- `success`: bool
- `log`: array of maps:
    - `type`: one of `info`, `warn`, `error`, ...
    - `message`: array of message fragments

##### `source_item_fetch_did_begin`
This event will always be followed by `source_item_fetch_did_end`.
It will be emitted for all source items in subscribed sources and for user-initiated fetches.

- `source_item`: source item id

##### `source_item_fetch_did_end`
- `source_item`: source item id
- `success`: bool
- `log`: array of maps:
    - `time`: nullable timestamp info
    - `type`: one of `info`, `warn`, `error`, ...
    - `message`: array of message fragments

##### `subscribed_source_did_update`
This event will be emitted for all subscribed sources.
If applicable, it will be emitted *after* `source_fetch_did_end`.

- `source`: source id
- `type`: string, one `update` or `delete`

##### `subscribed_source_item_did_update`
This event will be emitted for all subscribed sources’ items.
If applicable, it will be emitted *after* `source_item_fetch_did_end`.

- `source_item`: source item id
- `type`: string, one `update` or `delete`
