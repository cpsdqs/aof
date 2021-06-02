use crate::data::sources::{canonicalize_uri, SourceMetaItem};
use crate::data::users::UserId;
use crate::fetcher::Fetcher;
use crate::http_api::resources::{get_camo_response, CamoRequest};
use crate::state::State;
use actix_web::error::{BlockingError, InternalError};
use actix_web::web::Bytes;
use actix_web::{get, guard, http, web, HttpResponse, Responder, Scope};
use awc::http::StatusCode;
use serde::Deserialize;
use std::collections::BTreeMap;
use stream_generator::generate_try_stream;
use xml::writer::XmlEvent;
use xml::EventWriter;

const DEFAULT_ITEM_COUNT: usize = 20;

pub fn scope() -> Scope {
    web::scope("/rss")
        .service(
            web::resource("/{key}/resource")
                .guard(guard::Get())
                .name("rss_camo_resource")
                .to(rss_resource),
        )
        .service(rss)
}

#[derive(Deserialize)]
struct RssQuery {
    force_request: Option<bool>,
    limit: Option<usize>,
    camo: Option<bool>,
}

#[get("/{key}/source/{domain}/{path:.*}")]
async fn rss(
    data: web::Data<State>,
    request: web::HttpRequest,
    query: web::Query<RssQuery>,
) -> impl Responder {
    let auth_key = request.match_info().query("key");

    let user_id = match data.data().lock().rss_auth_key(auth_key) {
        Ok(Some(auth)) => auth.user_id(),
        Ok(None) => return HttpResponse::Forbidden().body("Forbidden"),
        Err(_) => return HttpResponse::InternalServerError().body("Internal server error"),
    };

    let domain = request.match_info().query("domain").to_owned();
    let path = request.match_info().query("path");
    let force_request = query.force_request.unwrap_or(false);
    let item_count = query.limit.unwrap_or(DEFAULT_ITEM_COUNT);
    let should_camo = query.camo.unwrap_or(true);

    let mut uri = String::from(&domain);
    uri.push_str("://");
    uri.push_str("/");
    uri.push_str(path);
    let uri = match canonicalize_uri(&uri) {
        Ok(uri) => uri.to_string(),
        Err(_) => return HttpResponse::BadRequest().body("Bad request"),
    };

    debug!(
        "Received RSS request: {:?} (force: {}, count: {}, camo: {})",
        uri, force_request, item_count, should_camo
    );

    if force_request {
        let data2 = data.data().clone();
        let uri2 = uri.clone();
        // TODO: send events to user
        let res = web::block(move || Fetcher::fetch_source(&data2, Some(user_id), &uri2)).await;
        match res {
            Ok(_) => (),
            Err(BlockingError::Error(_)) => return HttpResponse::BadGateway().body("Bad gateway"),
            Err(BlockingError::Canceled) => {
                return HttpResponse::InternalServerError().body("Internal server error")
            }
        }
    }

    let source_data = match data.data().lock().user_source(user_id, &uri) {
        Ok(Some(source_data)) => match source_data.version_date_hash() {
            Some((_, hash)) => match data.data().lock().source_by_hash(hash) {
                Ok(Some(version)) => version,
                _ => return HttpResponse::InternalServerError().body("Internal server error"),
            },
            None => return HttpResponse::NotFound().body("Not found"),
        },
        Ok(None) => return HttpResponse::NotFound().body("Not found"),
        Err(_) => return HttpResponse::InternalServerError().body("Internal server error"),
    };

    let source_data_tags = match source_data.tags() {
        Ok(tags) => tags,
        Err(_) => return HttpResponse::InternalServerError().body("Internal server error"),
    };
    let source_data_items = match source_data.items() {
        Ok(items) => items,
        Err(_) => return HttpResponse::InternalServerError().body("Internal server error"),
    };

    fn write_start<T>(
        xml_writer: &mut EventWriter<T>,
        source_data_tags: BTreeMap<String, serde_json::Value>,
        uri: &str,
    ) -> xml::writer::Result<()>
    where
        T: std::io::Write,
    {
        xml_writer.write(XmlEvent::StartDocument {
            version: xml::common::XmlVersion::Version10,
            encoding: "UTF-8".into(),
            standalone: None,
        })?;
        xml_writer.write(XmlEvent::start_element("rss").attr("version", "2.0"))?;
        xml_writer.write(XmlEvent::start_element("channel"))?;
        {
            xml_writer.write(XmlEvent::start_element("title"))?;
            match source_data_tags.get("title") {
                Some(serde_json::Value::String(title)) => {
                    xml_writer.write(XmlEvent::characters(title))?;
                }
                _ => {
                    xml_writer.write(XmlEvent::characters(uri))?;
                }
            }
            xml_writer.write(XmlEvent::end_element())?;
        }
        {
            xml_writer.write(XmlEvent::start_element("link"))?;
            match source_data_tags.get("canonical_url") {
                Some(serde_json::Value::String(url)) => {
                    xml_writer.write(XmlEvent::characters(url))?;
                }
                _ => {
                    // TODO: some sort of fallback?
                    xml_writer.write(XmlEvent::characters(""))?;
                }
            }
            xml_writer.write(XmlEvent::end_element())?;
        }
        let source_authors = {
            let mut authors = String::new();
            if let Some(serde_json::Value::Array(items)) = source_data_tags.get("authors") {
                let mut is_first = true;
                for item in items {
                    if let serde_json::Value::Object(obj) = item {
                        if let Some(serde_json::Value::String(name)) = obj.get("name") {
                            if is_first {
                                is_first = false;
                            } else {
                                authors.push_str(", ");
                            }
                            authors.push_str(name);
                        }
                    }
                }
            }
            authors
        };
        xml_writer.write(XmlEvent::start_element("description"))?;
        xml_writer.write(XmlEvent::characters(&source_authors))?;
        xml_writer.write(XmlEvent::end_element())?;
        Ok(())
    }
    fn write_item<T>(xml_writer: &mut EventWriter<T>, item: RssItemData) -> xml::writer::Result<()>
    where
        T: std::io::Write,
    {
        xml_writer.write(XmlEvent::start_element("item"))?;
        xml_writer.write(XmlEvent::start_element("guid"))?;
        xml_writer.write(XmlEvent::characters(&item.uri))?;
        xml_writer.write(XmlEvent::end_element())?;

        if let (None, None) = (&item.title, &item.contents) {
            // no title or contents, but one of title or description are required!
            xml_writer.write(XmlEvent::start_element("title"))?;
            if let Some(canon_url) = &item.canonical_url {
                xml_writer.write(XmlEvent::characters(&canon_url))?;
            } else {
                xml_writer.write(XmlEvent::characters(""))?;
            }
            xml_writer.write(XmlEvent::end_element())?;
        }
        if let Some(title) = &item.title {
            xml_writer.write(XmlEvent::start_element("title"))?;
            xml_writer.write(XmlEvent::characters(&title))?;
            xml_writer.write(XmlEvent::end_element())?;
        }
        if let Some(url) = &item.canonical_url {
            xml_writer.write(XmlEvent::start_element("link"))?;
            xml_writer.write(XmlEvent::characters(&url))?;
            xml_writer.write(XmlEvent::end_element())?;
        }
        if let Some(date_str) = &item.date {
            let date_str =
                if let Ok(date) = chrono::naive::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                    let date = chrono::offset::TimeZone::from_utc_date(&chrono::Utc, &date);
                    Some(date.and_hms(0, 0, 0).to_rfc2822())
                } else if let Ok(date) = chrono::DateTime::parse_from_rfc3339(date_str) {
                    Some(date.to_rfc2822())
                } else {
                    None
                };

            if let Some(date_str) = date_str {
                xml_writer.write(XmlEvent::start_element("pubDate"))?;
                xml_writer.write(XmlEvent::characters(&date_str))?;
                xml_writer.write(XmlEvent::end_element())?;
            }
        }
        if let Some(contents) = item.contents {
            xml_writer.write(XmlEvent::start_element("description"))?;
            xml_writer.write(XmlEvent::characters(&contents))?;
            xml_writer.write(XmlEvent::end_element())?;
        }
        xml_writer.write(XmlEvent::end_element())?;
        Ok(())
    }
    fn write_end<T>(xml_writer: &mut EventWriter<T>) -> xml::writer::Result<()>
    where
        T: std::io::Write,
    {
        xml_writer.write(XmlEvent::end_element())?;
        xml_writer.write(XmlEvent::end_element())?;
        Ok(())
    }

    async fn flush(
        writer: &mut EventWriter<Vec<u8>>,
        y: &mut stream_generator::Yielder<Result<Bytes, actix_web::Error>>,
    ) {
        let buf = writer.inner_mut();
        let bytes = Bytes::from(std::mem::replace(buf, Vec::new()));
        y.send(Ok(bytes)).await;
    }

    let camo_prefix = if should_camo {
        request
            .url_for("rss_camo_resource", &[auth_key])
            .ok()
            .map(|s| s.to_string())
    } else {
        None
    };
    let referrer = match source_data_tags.get("canonical_url") {
        Some(serde_json::Value::String(url)) => Some(url.to_owned()),
        _ => None,
    };

    let rss_stream = generate_try_stream(move |mut y| async move {
        let mut xml_writer = xml::EmitterConfig::new()
            .perform_indent(true)
            .create_writer(Vec::new());

        let mk_err = |e| InternalError::new(e, StatusCode::INTERNAL_SERVER_ERROR);
        write_start(&mut xml_writer, source_data_tags, &uri).map_err(mk_err)?;
        flush(&mut xml_writer, &mut y).await;

        for (i, item_meta) in source_data_items.iter().rev().enumerate() {
            if i >= item_count {
                break;
            }
            if let Ok(item) = RssItemData::new(
                item_meta,
                &data,
                user_id,
                &domain,
                (
                    camo_prefix.as_ref().map(|s| &**s),
                    referrer.as_ref().map(|s| &**s),
                ),
            ) {
                write_item(&mut xml_writer, item).map_err(mk_err)?;
                flush(&mut xml_writer, &mut y).await;
            }
        }
        write_end(&mut xml_writer).map_err(mk_err)?;
        flush(&mut xml_writer, &mut y).await;
        Ok(())
    });

    HttpResponse::Ok()
        .header(http::header::CONTENT_TYPE, "application/rss+xml")
        .streaming(Box::pin(rss_stream))
}

fn rewrite_html_resources(url_prefix: &str, html: String, referrer: Option<&str>) -> String {
    let create_url = move |original: &str| {
        if let Ok(mut new_src) = aof_script::url::Url::parse(url_prefix) {
            {
                let mut query_pairs = new_src.query_pairs_mut();
                query_pairs.append_pair("url", original);
                if let Some(referrer) = referrer {
                    query_pairs.append_pair("referrer", referrer);
                }
            }
            Some(new_src.to_string())
        } else {
            None
        }
    };

    let mut html_wrapped = String::new();
    html_wrapped.push_str("<!doctype html><html><head></head><body>");
    html_wrapped.push_str(&html);
    html_wrapped.push_str("</body></html>");
    let doc = nipper::Document::from(&html_wrapped);

    for mut link in doc.select("link").iter() {
        if let Some(src) = link.attr("href") {
            if src.starts_with("http:") || src.starts_with("https:") {
                if let Some(new_src) = create_url(&src) {
                    link.set_attr("href", &new_src);
                }
            }
        }
    }
    for mut img in doc.select("img").iter() {
        if let Some(src) = img.attr("src") {
            if src.starts_with("http:") || src.starts_with("https:") {
                if let Some(new_src) = create_url(&src) {
                    img.set_attr("src", &new_src);
                }
            }
        }
    }

    doc.select("body").html().to_string()
}

async fn rss_resource(
    data: web::Data<State>,
    request: web::HttpRequest,
    query: web::Query<CamoRequest>,
) -> impl Responder {
    let auth_key = request.match_info().query("key");

    match data.data().lock().rss_auth_key(auth_key) {
        Ok(Some(_)) => get_camo_response(&request, &query).await,
        Ok(None) => HttpResponse::Forbidden().body("Forbidden"),
        Err(_) => HttpResponse::InternalServerError().body("Internal server error"),
    }
}

struct RssItemData {
    uri: String,
    title: Option<String>,
    date: Option<String>,
    canonical_url: Option<String>,
    contents: Option<String>,
}

impl RssItemData {
    pub fn new(
        item_meta: &SourceMetaItem,
        data: &web::Data<State>,
        user_id: UserId,
        domain: &str,
        camo: (Option<&str>, Option<&str>),
    ) -> Result<RssItemData, ()> {
        let title = match item_meta.tags.get("title") {
            Some(serde_json::Value::String(title)) => Some(title.to_owned()),
            _ => None,
        };
        let mut date = match item_meta.tags.get("last_updated") {
            Some(serde_json::Value::String(date)) => Some(date.to_owned()),
            _ => None,
        };
        let mut canonical_url = match item_meta.tags.get("canonical_url") {
            Some(serde_json::Value::String(url)) => Some(url.to_owned()),
            _ => None,
        };
        let mut contents = None;

        let mut item_uri = String::from(domain);
        item_uri.push_str("://");
        item_uri.push_str(&item_meta.path);
        let item_uri = match canonicalize_uri(&item_uri) {
            Ok(uri) => uri.to_string(),
            Err(_) => return Err(()),
        };

        if item_meta.is_virtual {
            contents = match item_meta.tags.get("contents") {
                Some(serde_json::Value::String(contents)) => Some(contents.to_owned()),
                _ => None,
            };
        } else {
            let source_item_data = match data.data().lock().user_source_item(user_id, &item_uri) {
                Ok(Some(source_item_data)) => match source_item_data.version_date_hash() {
                    Some((_, hash)) => match data.data().lock().source_item_by_hash(hash) {
                        Ok(Some(source_item_data)) => Some(source_item_data),
                        _ => None,
                    },
                    _ => None,
                },
                _ => None,
            };

            if let Some(Ok(item_data)) = source_item_data.map(|d| d.get_data()) {
                if let Some(serde_json::Value::String(url)) = item_data.tags.get("canonical_url") {
                    canonical_url = Some(url.to_owned());
                }
                if let Some(serde_json::Value::String(item_date)) =
                    item_data.tags.get("last_updated")
                {
                    date = Some(item_date.to_owned());
                }
                let preface_contents =
                    if let Some(serde_json::Value::Object(obj)) = item_data.tags.get("preface") {
                        let mut contents = String::new();
                        for k in obj.keys() {
                            if let Some(serde_json::Value::String(v)) = obj.get(k) {
                                contents.push_str("<blockquote><h3>");
                                contents.push_str(k);
                                contents.push_str("</h3>");
                                contents.push_str(v);
                                contents.push_str("</blockquote>");
                            }
                        }
                        Some(contents)
                    } else {
                        None
                    };
                let main_contents = if let Some(serde_json::Value::String(contents)) =
                    item_data.tags.get("contents")
                {
                    Some(contents.to_owned())
                } else {
                    contents
                };
                let appendix_contents =
                    if let Some(serde_json::Value::Object(obj)) = item_data.tags.get("appendix") {
                        let mut contents = String::new();
                        for k in obj.keys() {
                            if let Some(serde_json::Value::String(v)) = obj.get(k) {
                                contents.push_str("<blockquote><h3>");
                                contents.push_str(k);
                                contents.push_str("</h3>");
                                contents.push_str(v);
                                contents.push_str("</blockquote>");
                            }
                        }
                        Some(contents)
                    } else {
                        None
                    };

                if preface_contents.is_some()
                    || main_contents.is_some()
                    || appendix_contents.is_some()
                {
                    let mut c = String::new();
                    if let Some(pre) = preface_contents {
                        c.push_str(&pre);
                    }
                    if let Some(main) = main_contents {
                        c.push_str(&main);
                    }
                    if let Some(app) = appendix_contents {
                        c.push_str(&app);
                    }
                    contents = Some(c);
                } else {
                    contents = None;
                }
            }
        }

        if let (Some(url_prefix), referrer) = camo {
            // fix weird double slashes in URL that might appear due to the way routing works
            let url_prefix = url_prefix.to_string().replace("//", "/");
            contents = contents.map(|c| rewrite_html_resources(&url_prefix, c, referrer));
        }

        Ok(RssItemData {
            uri: item_uri,
            title,
            date,
            canonical_url,
            contents,
        })
    }
}
