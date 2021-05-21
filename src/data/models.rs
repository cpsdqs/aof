use super::schema::source_domains;
use super::schema::users;

#[derive(Debug, Clone, Queryable, Identifiable)]
#[table_name = "users"]
pub struct User {
    pub id: Option<i32>,
    pub name: String,
    pub password: String,
    pub secret_key: String,
    pub tokens: i32,
    pub client_key: Vec<u8>,
}

#[derive(Insertable)]
#[table_name = "users"]
pub struct NewUser<'a> {
    pub name: &'a str,
    pub password: &'a str,
    pub secret_key: &'a str,
    pub tokens: &'a i32,
    pub client_key: &'a [u8],
}

#[derive(Debug, Queryable)]
pub struct UserSource {
    pub id: Option<i32>,
    pub user_id: i32,
    pub uri: String,
    pub version_date: Option<String>,
    pub version_hash: Option<String>,
    pub user_data: Option<Vec<u8>>,
}

#[derive(Debug, Queryable)]
pub struct UserSourceItem {
    pub id: Option<i32>,
    pub user_id: i32,
    pub uri: String,
    pub version_date: Option<String>,
    pub version_hash: Option<String>,
    pub user_data: Option<Vec<u8>>,
}

#[derive(Debug, Queryable)]
pub struct SourceVersion {
    pub id: Option<i32>,
    pub uri: String,
    pub hash: String,
    pub metadata: Vec<u8>,
    pub date_updated: Option<String>,
    pub items: Vec<u8>,
}

#[derive(Debug, Queryable)]
pub struct SourceItemVersion {
    pub id: Option<i32>,
    pub uri: String,
    pub hash: String,
    pub date_updated: Option<String>,
    pub data: Vec<u8>,
}

#[derive(Queryable)]
pub struct SourceResource {
    pub id: Option<i32>,
    pub hash: String,
    pub metadata: Vec<u8>,
    pub data: Vec<u8>,
}

#[derive(Debug, Queryable, Identifiable, AsChangeset)]
#[table_name = "source_domains"]
pub struct SourceDomain {
    pub id: Option<i32>,
    pub domain: String,
    pub abbrev: String,
    pub name: String,
    pub description: String,
    pub owner_id: i32,
    pub is_public: bool,
    pub script: String,
}

#[derive(Insertable)]
#[table_name = "source_domains"]
pub struct NewSourceDomain<'a> {
    pub domain: &'a str,
    pub abbrev: &'a str,
    pub name: &'a str,
    pub description: &'a str,
    pub owner_id: &'a i32,
    pub is_public: &'a bool,
    pub script: &'a str,
}

#[derive(Debug, Clone, Queryable)]
pub struct RssAuthKey {
    pub id: Option<i32>,
    pub user_id: i32,
    pub label: Option<String>,
    pub auth_key: String,
    pub tokens: i32,
}
