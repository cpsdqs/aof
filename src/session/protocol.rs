use crate::data::sources::SourceMetaItem;
use crate::fetcher::{FetchMsg, FetchTime};
use aof_script::console::{MessageType, MsgFrag};
use byteorder::{ReadBytesExt, WriteBytesExt, BE};
use serde::{Deserialize, Serialize, Serializer};
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::string::FromUtf8Error;
use thiserror::Error;

pub const MAX_MSG_SIZE: usize = 16384;
pub const MAX_MSG_BUF_SIZE: usize = 1048576;
pub type RequestId = u32;

const MSG_TYPE_CLIENT_REQ: u8 = 0xc0;
const MSG_TYPE_SERVER_RES: u8 = 0xc8;
const MSG_TYPE_SERVER_RES_CONT: u8 = 0xc9;
pub const MSG_TYPE_SERVER_ERR_RES: u8 = 0xcc;
const MSG_TYPE_SERVER_EVENT: u8 = 0xb8;

#[derive(Debug, Error)]
pub enum MsgParseError {
    #[error("unknown message type {0:x?}")]
    UnknownType(u8),
    #[error("utf-8 error in request name: {0}")]
    NameUtf8(#[from] FromUtf8Error),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    ReqDeser(#[from] ReqDeserError),
    #[error("unexpected trailing bytes")]
    TrailingBytes,
}

#[derive(Debug)]
pub enum ClientMsg {
    Request(RequestId, Request),
}

/// Parses a message from the client.
pub fn parse_message<T>(mut msg: T) -> Result<ClientMsg, MsgParseError>
where
    T: Read,
{
    let msg_type = msg.read_u8()?;
    if msg_type == MSG_TYPE_CLIENT_REQ {
        let (req_id, req) = parse_client_req(msg)?;
        Ok(ClientMsg::Request(req_id, req))
    } else {
        // no other client messages atm
        Err(MsgParseError::UnknownType(msg_type))
    }
}

/// Parses a client request.
fn parse_client_req<T>(mut msg: T) -> Result<(RequestId, Request), MsgParseError>
where
    T: Read,
{
    let req_id = msg.read_u32::<BE>()?;

    let name_len = msg.read_u8()? as usize;
    let mut name_buf = Vec::with_capacity(name_len);
    name_buf.resize(name_len, 0);
    msg.read_exact(&mut name_buf)?;
    let name = String::from_utf8(name_buf)?;

    let req = Request::deser(name, &mut msg)?;

    // require EOF
    match msg.bytes().next() {
        Some(Ok(_)) => return Err(MsgParseError::TrailingBytes),
        _ => (),
    }

    Ok((req_id, req))
}

#[derive(Debug, Error)]
enum ReqDeserError {
    #[error("unknown request named {0:?}")]
    UnknownName(String),
    #[error("failed to decode data: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
}

macro_rules! def_requests {
    (
        $name:ident;
        $($s_name:expr => $s_key:ident),+;
        $($r_name:expr => $r_key:ident {
            $( $(#[$att:meta])* $rfn:ident : $rft:ty ),* $(,)?
        },)+
    ) => {
        #[derive(Debug, Clone)]
        pub enum $name {
            $( $s_key, )+
            $(
                $r_key {
                    $( $rfn : $rft ),*
                }
            ),+
        }

        impl $name {
            fn deser<T>(name: String, data: T) -> Result<Self, ReqDeserError>
                where T: Read
            {
                match &*name {
                    $(
                        $s_name => Ok(Self:: $s_key),
                    )+
                    $(
                        $r_name => {
                            #[derive(Debug, Deserialize)]
                            struct Deser {
                                $( $(#[$att])* $rfn : $rft ),*
                            }

                            let res: Deser = rmp_serde::from_read(data)?;
                            Ok(Self:: $r_key {
                                $( $rfn : res . $rfn ),*
                            })
                        },
                    )+
                    _ => Err(ReqDeserError::UnknownName(name))
                }
            }
        }
    };
}

struct BlobVisitor;
impl<'a> serde::de::Visitor<'a> for BlobVisitor {
    type Value = Vec<u8>;

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a binary blob")
    }

    fn visit_bytes<E>(self, v: &[u8]) -> Result<Vec<u8>, E> {
        Ok(v.to_vec())
    }
}
fn deser_blob<'de, D>(de: D) -> Result<Vec<u8>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    de.deserialize_bytes(BlobVisitor)
}

def_requests! {
    Request;
    "user_client_key" => UserClientKey,
    "user_secret_key" => UserSecretKey,
    "user_sources" => UserSources,
    "user_tokens" => UserTokens,
    "user_domains" => UserDomains,
    "public_domains" => PublicDomains,
    "user_rss_auth_keys" => UserRssAuthKeys,
    "user_regen_client_key" => UserRegenClientKey,
    "user_enumerate_objects" => UserEnumerateObjects;

    "user_change_name" => UserChangeName { new_name: String },
    "user_change_password" => UserChangePassword { password: String, new_password: String },
    "user_change_secret_key" => UserChangeSecretKey { password: String, new_secret_key: String },
    "user_delete" => UserDelete { password: String },

    "source" => Source { uri: String },
    "source_item" => SourceItem { uri: String },
    "source_item_data" => SourceItemData { uri: String },
    "source_user_data" => SourceUserData { uri: String },
    "source_item_user_data" => SourceItemUserData { uri: String },

    "user_subscribe_source" => UserSubscribeSource { uri: String },
    "user_unsubscribe_source" => UserUnsubscribeSource { uri: String },
    "user_delete_source" => UserDeleteSource { uri: String },
    "user_request_source" => UserRequestSource { uri: String },
    "user_request_source_item" => UserRequestSourceItem { uri: String },
    "set_source_user_data" => SetSourceUserData {
        uri: String,
        #[serde(deserialize_with = "deser_blob")]
        data: Vec<u8>,
    },
    "set_source_item_user_data" => SetSourceItemUserData {
        uri: String,
        #[serde(deserialize_with = "deser_blob")]
        data: Vec<u8>,
    },

    "user_create_domain" => UserCreateDomain { abbrev: String, name: String },
    "user_update_domain" => UserUpdateDomain {
        id: String,
        abbrev: String,
        name: String,
        description: String,
        is_public: bool,
        script: String,
    },
    "user_delete_domain" => UserDeleteDomain { id: String },
    "domain" => Domain { id: String },
    "domain_script" => DomainScript { id: String },
    "user_subscribe_domain" => UserSubscribeDomain { id: String },
    "user_unsubscribe_domain" => UserUnsubscribeDomain { id: String },

    "user_create_rss_auth_key" => UserCreateRssAuthKey { label: Option<String> },
    "user_delete_rss_auth_key" => UserDeleteRssAuthKey { key: String },
}

#[derive(Debug, Error)]
pub enum WriteError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("failed to encode payload: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error("message is too large")]
    TooLarge,
}

/// A response with `success`: `bool` or an error.
pub enum SimpleResult {
    Ok,
    Err { error: &'static str },
}

impl Serialize for SimpleResult {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeMap;
        match self {
            SimpleResult::Ok => {
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("success", &true)?;
                map.end()
            }
            SimpleResult::Err { error } => {
                let mut map = serializer.serialize_map(Some(2))?;
                map.serialize_entry("success", &false)?;
                map.serialize_entry("error", error)?;
                map.end()
            }
        }
    }
}

#[derive(Serialize)]
pub struct ResponseDomain {
    pub abbrev: String,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub editable: bool,
}

#[derive(Serialize)]
pub struct DomainScriptResult {
    pub success: bool,
    pub script: Option<String>,
    pub error: Option<&'static str>,
}

pub type ResponseSourceItem = BTreeMap<String, serde_json::Value>;

#[derive(Serialize)]
pub struct SourceItemResult {
    pub loaded: bool,
    pub data: Option<SourceItemResultData>,
}

#[derive(Serialize)]
pub struct SourceItemResultData {
    pub last_fetched: String,
    pub last_updated: Option<String>,
}

#[derive(Serialize)]
pub struct SourceResult {
    pub loaded: bool,
    pub data: Option<SourceResultData>,
}

#[derive(Serialize)]
pub struct SourceResultData {
    pub last_fetched: String,
    pub last_updated: Option<String>,
    pub data: BTreeMap<String, serde_json::Value>,
    pub items: Vec<SourceMetaItem>,
}

#[derive(Serialize)]
pub struct ResponseRssAuthKey {
    pub label: Option<String>,
    pub key: String,
}

#[derive(Serialize)]
pub struct UserCreateRssAuthKeyResult {
    pub success: bool,
    pub key: String,
    pub error: &'static str,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum Response {
    UserClientKey(Vec<u8>),
    UserSecretKey(String),
    UserSources(Vec<String>),
    UserTokens(u16),
    UserChangeName(SimpleResult),
    UserChangePassword(SimpleResult),
    UserChangeSecretKey(SimpleResult),
    UserDelete(SimpleResult),
    UserRegenClientKey(()),

    UserDomains(Vec<String>),
    PublicDomains(Vec<String>),
    Domain(Option<ResponseDomain>),
    DomainScript(DomainScriptResult),
    UserCreateDomain(UserCreateDomainResult),
    UserUpdateDomain(SimpleResult),
    UserDeleteDomain(SimpleResult),
    UserSubscribeDomain(SimpleResult),
    UserUnsubscribeDomain(SimpleResult),

    Source(SourceResult),
    SourceItem(SourceItemResult),
    SourceItemData(Option<ResponseSourceItem>),
    SourceUserData(Option<Vec<u8>>),
    SourceItemUserData(Option<Vec<u8>>),
    UserSubscribeSource(SimpleResult),
    UserUnsubscribeSource(SimpleResult),
    UserDeleteSource(SimpleResult),
    UserRequestSource(SimpleResult),
    UserRequestSourceItem(SimpleResult),
    SetSourceUserData(SimpleResult),
    SetSourceItemUserData(SimpleResult),

    UserRssAuthKeys(Vec<ResponseRssAuthKey>),
    UserCreateRssAuthKey(UserCreateRssAuthKeyResult),
    UserDeleteRssAuthKey(SimpleResult),
}

#[derive(Serialize)]
pub struct UserCreateDomainResult {
    pub success: bool,
    pub id: String,
    pub error: &'static str,
}

pub struct EncodedResponse {
    id: RequestId,
    data: Vec<u8>,
    position: usize,
}

impl Response {
    pub fn encode(&self, id: RequestId) -> Result<EncodedResponse, WriteError> {
        let mut buf = Vec::new();
        rmp_serde::encode::write_named(&mut buf, self)?;
        if buf.len() > MAX_MSG_BUF_SIZE {
            return Err(WriteError::TooLarge);
        }

        Ok(EncodedResponse {
            id,
            data: buf,
            position: 0,
        })
    }
}

impl EncodedResponse {
    pub fn id(&self) -> RequestId {
        self.id
    }
    /// Writes a chunk and returns whether it's done.
    pub fn write_chunk<T>(&mut self, mut out: T) -> Result<bool, WriteError>
    where
        T: Write,
    {
        if self.position == 0 {
            out.write_u8(MSG_TYPE_SERVER_RES)?;
            out.write_u32::<BE>(self.id)?;
            out.write_u32::<BE>(self.data.len() as u32)?;
        } else {
            out.write_u8(MSG_TYPE_SERVER_RES_CONT)?;
            out.write_u32::<BE>(self.id)?;
        }

        let msg_bytes_left = MAX_MSG_SIZE - 16;
        let data_bytes_left = self.data.len() - self.position;

        if data_bytes_left <= msg_bytes_left {
            out.write_all(&self.data[self.position..])?;
            self.position += data_bytes_left;
            Ok(true)
        } else {
            let next_pos = self.position + msg_bytes_left;
            out.write_all(&self.data[self.position..next_pos])?;
            self.position = next_pos;
            Ok(false)
        }
    }
}

#[derive(Serialize, Debug, Clone, Copy)]
pub enum UpdateType {
    #[serde(rename = "update")]
    Update,
    #[serde(rename = "delete")]
    Delete,
}

#[derive(Serialize, Debug, Clone)]
struct FetchLogMsgType(&'static str);

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "snake_case")]
#[serde(tag = "t", content = "c")]
enum FetchLogFrag {
    Log(String),
    ClassName(String),
    ObjectStart,
    ErrorTrace(String),
    ObjectEnd,
    ArrayStart,
    ArrayEnd,
    ObjectMapsTo,
    ListSep,
    Truncated,
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Symbol(String),
    KeyString(String),
    KeySymbol(String),
    Circular,
    Function(String),
    Unknown,
    ArgSep,
}

#[derive(Serialize, Debug, Clone)]
pub struct FetchLogTime {
    real: f64,
    script: f64,
    fetch: f64,
}

#[derive(Serialize, Debug, Clone)]
pub struct FetchLogItem {
    time: Option<FetchLogTime>,
    #[serde(rename = "type")]
    msg_type: FetchLogMsgType,
    message: Vec<FetchLogFrag>,
}

impl From<MessageType> for FetchLogMsgType {
    fn from(this: MessageType) -> Self {
        match this {
            MessageType::Debug => Self("debug"),
            MessageType::Log => Self("log"),
            MessageType::Info => Self("info"),
            MessageType::Trace => Self("trace"),
            MessageType::Warn => Self("warn"),
            MessageType::Error => Self("error"),
            MessageType::Stdout => Self("stdout"),
            MessageType::Stderr => Self("stderr"),
        }
    }
}

impl From<MsgFrag> for FetchLogFrag {
    fn from(this: MsgFrag) -> Self {
        match this {
            MsgFrag::Log(s) => Self::Log(s),
            MsgFrag::ClassName(s) => Self::ClassName(s),
            MsgFrag::ObjectStart => Self::ObjectStart,
            MsgFrag::ErrorTrace(s) => Self::ErrorTrace(s),
            MsgFrag::ObjectEnd => Self::ObjectEnd,
            MsgFrag::ArrayStart => Self::ArrayStart,
            MsgFrag::ArrayEnd => Self::ArrayEnd,
            MsgFrag::ObjectMapsTo => Self::ObjectMapsTo,
            MsgFrag::ListSep => Self::ListSep,
            MsgFrag::Truncated => Self::Truncated,
            MsgFrag::Undefined => Self::Undefined,
            MsgFrag::Null => Self::Null,
            MsgFrag::Bool(b) => Self::Bool(b),
            MsgFrag::Number(n) => Self::Number(n),
            MsgFrag::String(s) => Self::String(s),
            MsgFrag::Symbol(s) => Self::Symbol(s),
            MsgFrag::KeyString(s) => Self::KeyString(s),
            MsgFrag::KeySymbol(s) => Self::KeySymbol(s),
            MsgFrag::Circular => Self::Circular,
            MsgFrag::Function(n) => Self::Function(n),
            MsgFrag::Unknown => Self::Unknown,
            MsgFrag::ArgSep => Self::ArgSep,
        }
    }
}

impl From<FetchTime> for FetchLogTime {
    fn from(this: FetchTime) -> Self {
        // we don't want high-precision timing (probably an attack vector idk)
        fn lp(x: std::time::Duration) -> f64 {
            // 16 ms precision
            (x.as_millis() / 16) as f64 * 16. / 1000.
        }

        FetchLogTime {
            real: lp(this.real),
            script: lp(this.script),
            fetch: lp(this.fetch),
        }
    }
}

impl From<FetchMsg> for FetchLogItem {
    fn from(this: FetchMsg) -> Self {
        FetchLogItem {
            time: this.time.map(|x| x.into()),
            msg_type: this.msg.msg_type.into(),
            message: this.msg.message.into_iter().map(|x| x.into()).collect(),
        }
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(untagged)]
pub enum Event {
    ProtocolError {
        error: String,
    },
    UserDidSubscribeSource {
        source: String,
    },
    UserDidUnsubscribeSource {
        source: String,
    },
    UserDidSubscribeDomain {
        domain: String,
    },
    UserDidUnsubscribeDomain {
        domain: String,
    },
    SourceUserDataDidUpdate {
        source: String,
    },
    SourceItemUserDataDidUpdate {
        source_item: String,
    },
    SubscribedDomainDidUpdate {
        domain: String,
    },
    SourceFetchDidBegin {
        source: String,
    },
    SourceFetchDidEnd {
        source: String,
        success: bool,
        log: Vec<FetchLogItem>,
    },
    SourceItemFetchDidBegin {
        source_item: String,
    },
    SourceItemFetchDidEnd {
        source_item: String,
        success: bool,
        log: Vec<FetchLogItem>,
    },
    SubscribedSourceDidUpdate {
        source: String,
        #[serde(rename = "type")]
        update_type: UpdateType,
    },
    SubscribedSourceItemDidUpdate {
        source_item: String,
        #[serde(rename = "type")]
        update_type: UpdateType,
    },
}

impl Event {
    fn name(&self) -> &'static str {
        match self {
            Event::ProtocolError { .. } => "protocol_error",
            Event::UserDidSubscribeSource { .. } => "user_did_subscribe_source",
            Event::UserDidUnsubscribeSource { .. } => "user_did_unsubscribe_source",
            Event::UserDidSubscribeDomain { .. } => "user_did_subscribe_domain",
            Event::UserDidUnsubscribeDomain { .. } => "user_did_unsubscribe_domain",
            Event::SourceUserDataDidUpdate { .. } => "source_user_data_did_update",
            Event::SourceItemUserDataDidUpdate { .. } => "source_item_user_data_did_update",
            Event::SubscribedDomainDidUpdate { .. } => "subscribed_domain_did_update",
            Event::SourceFetchDidBegin { .. } => "source_fetch_did_begin",
            Event::SourceFetchDidEnd { .. } => "source_fetch_did_end",
            Event::SourceItemFetchDidBegin { .. } => "source_item_fetch_did_begin",
            Event::SourceItemFetchDidEnd { .. } => "source_item_fetch_did_end",
            Event::SubscribedSourceDidUpdate { .. } => "subscribed_source_did_update",
            Event::SubscribedSourceItemDidUpdate { .. } => "subscribed_source_item_did_update",
        }
    }
    pub fn write<T>(&self, mut out: T) -> Result<(), WriteError>
    where
        T: Write,
    {
        out.write_u8(MSG_TYPE_SERVER_EVENT)?;
        let name = self.name();
        out.write_u8(name.len() as u8)?;
        out.write_all(name.as_bytes())?;
        rmp_serde::encode::write_named(&mut out, self)?;
        Ok(())
    }
}
