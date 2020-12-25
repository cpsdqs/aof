# Auto Fetcher
Fetches web things semi-regularly

AOF is a server application for regularly fetching web comics and the likes to check for updates,
without making use of standard formats. It also includes a web interface.

### Current Caveats
- It does not support cumulative streams such as RSS
- The only way to access data in a machine-readable format is via a non-standard API
- The scripting API is quite flaky
- There will be a lot of errors like `[ERROR r2d2] database is locked` and I’m not sure why
  (the server seems to be working fine?)

### Conceptual Overview
- Data is organized into domains, sources, and source items.
- Domains contain scripts that may fetch and return arbitrary data given a path in that domain.
- Sources each belong to a domain and are identified by a path.
  They provide metadata and a list of source items.
- Source items are the actual contents of the source, in HTML.
- Users can subscribe to a source to have the auto-fetcher periodically update the source and load
  its items automatically, or manually fetch the data for themselves if necessary.
- The auto-fetcher currently uses a probabilistic algorithm to schedule fetches and will update a
  source roughly according to its last update date.

## Usage
To build everything, run `build.sh`.
Because of OpenSSL, cross-compilation does *not* work.

Note that this server expects a reverse proxy and will always take following headers at face value:
- `Forwarded`
- `X-Forwarded-For`
- `X-Forwarded-Host`

#### Setup
1. Extract `build.tar.gz` to find `aof` and `static/`
1. Create a configuration file using `./aof generate-config`
1. Edit the configuration file if necessary
1. Create a registration token using `./aof --create-token`. This will also create the database.
1. Run `./aof` to start the server
1. Sign up via the web interface

#### Content Security Policy
Required items:

- `style-src`
    - `'self'`
    - `'unsafe-inline'` for content styles and ace editor
- `script-src`
    - `'self'`
    - `'unsafe-eval'` for WebAssembly
    - Do NOT allow `'unsafe-inline'`
- `img-src`
    - `'self'`
    - `data:` for ace editor
- `child-src`
    - `'self'` for web workers
    - `blob:` for ace editor web workers
- `connect-src`
    - `'self'`
    - `wss://<domain>` for web sockets
    
## impl todo
- enforce max size of resources
- implement rate limiting tokens
- general rate limiting
- implement rest of events
- user data read state can get too big for the protocol if the source has like 500 items
- delete resources thing in db bc not gonna use it probably
- decrypting SK later does not cause views that requested decryption earlier to update (wontfix?)
- fix logging in with case-insensitive name not fixing the name (fixed maybe? idk)
- some way of doing infinite streams (e.g. RSS)
- setTimeout is not defined in domain scripts?? (not very important)
- deno URL is horribly broken
- two different sources with the same hash will collide in multiple ways (will this cause issues?)
- client sends redundant requests if data isn't loaded yet but used in multiple places at once
