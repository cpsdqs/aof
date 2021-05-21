create table user_rss_auth_keys (
    id integer primary key,
    user_id integer not null,
    label varchar default null,
    auth_key varchar not null unique,
    tokens integer not null default 0
);
