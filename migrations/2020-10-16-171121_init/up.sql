create table users (
    id integer primary key autoincrement,
    name varchar not null unique collate nocase,
    password varchar not null,
    secret_key varchar not null,
    tokens int not null default 0
);

create table user_sources (
    id integer primary key,
    user_id integer not null,
    uri varchar not null,
    version_date varchar default null,
    version_hash varchar default null,
    user_data blob default (x''),
    unique (user_id, uri)
);

create table user_source_subscriptions (
     id integer primary key,
     user_id integer not null,
     uri varchar not null,
     unique (user_id, uri)
);

create table user_source_items (
    id integer primary key,
    user_id integer not null,
    uri varchar not null,
    version_date varchar default null,
    version_hash varchar default null,
    user_data blob default (x''),
    unique (user_id, uri)
);

create table source_versions (
    id integer primary key,
    uri varchar not null,
    hash varchar not null unique,
    metadata blob not null,
    date_updated varchar,
    items blob not null
);

create table source_item_versions (
    id integer primary key,
    uri varchar not null,
    hash varchar not null unique,
    date_updated varchar,
    data blob not null
);

create table source_version_associated_items (
    id integer primary key,
    source_uri varchar not null,
    source_hash varchar not null,
    item_uri varchar not null,
    unique (source_hash, item_uri)
);

create table source_resources (
    id integer primary key,
    hash varchar not null unique,
    metadata blob not null,
    data blob not null
);

create table source_item_resource_dependencies (
    id integer primary key,
    source_item_hash varchar not null,
    resource_hash varchar not null,
    unique (source_item_hash, resource_hash)
);

create table registration_tokens (
    id integer primary key,
    token varchar not null unique,
    valid_until varchar not null
);

create table source_domains (
    id integer primary key,
    domain varchar not null unique,
    abbrev varchar not null collate nocase,
    name varchar not null collate nocase,
    description text not null,
    owner_id integer not null,
    is_public boolean not null,
    script text not null
);

create table user_source_domain_subscriptions (
    id integer primary key,
    user_id integer not null,
    domain varchar not null,
    unique (user_id, domain)
);
