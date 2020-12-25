table! {
    registration_tokens (id) {
        id -> Nullable<Integer>,
        token -> Text,
        valid_until -> Text,
    }
}

table! {
    source_domains (id) {
        id -> Nullable<Integer>,
        domain -> Text,
        abbrev -> Text,
        name -> Text,
        description -> Text,
        owner_id -> Integer,
        is_public -> Bool,
        script -> Text,
    }
}

table! {
    source_item_resource_dependencies (id) {
        id -> Nullable<Integer>,
        source_item_hash -> Text,
        resource_hash -> Text,
    }
}

table! {
    source_item_versions (id) {
        id -> Nullable<Integer>,
        uri -> Text,
        hash -> Text,
        date_updated -> Nullable<Text>,
        data -> Binary,
    }
}

table! {
    source_resources (id) {
        id -> Nullable<Integer>,
        hash -> Text,
        metadata -> Binary,
        data -> Binary,
    }
}

table! {
    source_version_associated_items (id) {
        id -> Nullable<Integer>,
        source_uri -> Text,
        source_hash -> Text,
        item_uri -> Text,
    }
}

table! {
    source_versions (id) {
        id -> Nullable<Integer>,
        uri -> Text,
        hash -> Text,
        metadata -> Binary,
        date_updated -> Nullable<Text>,
        items -> Binary,
    }
}

table! {
    user_source_domain_subscriptions (id) {
        id -> Nullable<Integer>,
        user_id -> Integer,
        domain -> Text,
    }
}

table! {
    user_source_items (id) {
        id -> Nullable<Integer>,
        user_id -> Integer,
        uri -> Text,
        version_date -> Nullable<Text>,
        version_hash -> Nullable<Text>,
        user_data -> Nullable<Binary>,
    }
}

table! {
    user_source_subscriptions (id) {
        id -> Nullable<Integer>,
        user_id -> Integer,
        uri -> Text,
    }
}

table! {
    user_sources (id) {
        id -> Nullable<Integer>,
        user_id -> Integer,
        uri -> Text,
        version_date -> Nullable<Text>,
        version_hash -> Nullable<Text>,
        user_data -> Nullable<Binary>,
    }
}

table! {
    users (id) {
        id -> Nullable<Integer>,
        name -> Text,
        password -> Text,
        secret_key -> Text,
        tokens -> Integer,
        client_key -> Binary,
    }
}

allow_tables_to_appear_in_same_query!(
    registration_tokens,
    source_domains,
    source_item_resource_dependencies,
    source_item_versions,
    source_resources,
    source_version_associated_items,
    source_versions,
    user_source_domain_subscriptions,
    user_source_items,
    user_source_subscriptions,
    user_sources,
    users,
);
