use crate::config::Config;
use crate::data::sources::canonicalize_uri;
use crate::data::DataError;
use crate::fetcher::Fetcher;
use crate::state::{SharedData, State};
use aof_script::url::Url;
use chrono::{DateTime, NaiveDate, Utc};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

// TODO: better algorithm

const PHASE_OFFSET_TIME: Duration = Duration::from_secs(3);

fn get_cycle_sleep() -> Duration {
    Duration::from_secs(
        Config::shared()
            .auto_fetcher
            .as_ref()
            .map(|f| f.major_interval)
            .unwrap_or(3600),
    )
}
fn get_fetcher_wait() -> Duration {
    Duration::from_secs(
        Config::shared()
            .auto_fetcher
            .as_ref()
            .map(|f| f.minor_interval)
            .unwrap_or(45),
    )
}
fn get_fetcher_item_wait() -> Duration {
    Duration::from_secs(
        Config::shared()
            .auto_fetcher
            .as_ref()
            .map(|f| f.minor_item_interval)
            .unwrap_or(40),
    )
}

pub fn start(state: Arc<State>) {
    let fstate: Arc<Mutex<AutoFetcherState>> = Default::default();

    debug!(
        "auto fetcher intervals: Q {:?} S {:?} I {:?}",
        get_cycle_sleep(),
        get_fetcher_wait(),
        get_fetcher_item_wait()
    );

    let fetcher_count = Config::shared()
        .auto_fetcher
        .as_ref()
        .map(|f| f.fetcher_count)
        .unwrap_or(3);

    debug!("starting {} fetcher thread(s)", fetcher_count);

    for i in 0..(1 + fetcher_count) {
        let mut name = format!("auto-fetcher-{}", i);
        let is_enqueue_thread = i == 0;
        if is_enqueue_thread {
            name += "-NQ";
        }

        let fstate2 = Arc::clone(&fstate);
        let state2 = Arc::clone(&state);
        thread::Builder::new()
            .name(name)
            .spawn(move || {
                let mut auto_fetcher = AutoFetcher::new(fstate2, state2);

                if is_enqueue_thread {
                    loop {
                        auto_fetcher.maybe_enqueue();
                        thread::sleep(get_cycle_sleep());
                    }
                } else {
                    thread::sleep(PHASE_OFFSET_TIME * i as u32);
                    loop {
                        auto_fetcher.cycle();
                        thread::sleep(get_fetcher_wait());
                    }
                }
            })
            .expect("Failed to create fetcher thread!");
    }
}

/// Contains a weight for when a source last updated to predict when it will next update.
/// The number ranges from 0 to 65535 where 0 is least and 65535 most recent.
/// The enum variants indicate order of magnitude.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum UpdateProjection {
    Week(u16),
    Day(u16),
    Hour(u16),
}

impl UpdateProjection {
    fn update_probability(&self) -> f64 {
        match self {
            UpdateProjection::Hour(_) => 1.,
            UpdateProjection::Day(k) => (1. - *k as f64 / 65535. / 7.).max(0.4),
            UpdateProjection::Week(k) => (0.4 - *k as f64 / 65535. / 7.).max(0.07),
        }
    }
}

impl Default for UpdateProjection {
    fn default() -> Self {
        UpdateProjection::Day(0xffff)
    }
}

struct FetcherJob {
    up: UpdateProjection,
    source: String,
}

#[derive(Default)]
struct AutoFetcherState {
    queue: VecDeque<FetcherJob>,
}

struct AutoFetcher {
    fetcher_state: Arc<Mutex<AutoFetcherState>>,
    state: Arc<State>,
}

impl AutoFetcher {
    fn new(fstate: Arc<Mutex<AutoFetcherState>>, state: Arc<State>) -> Self {
        Self {
            fetcher_state: fstate,
            state,
        }
    }

    fn cycle(&mut self) {
        match self.fetch_one() {
            Ok(_) => (),
            Err(e) => {
                error!("failed to fetch: {}", e);
            }
        }
    }

    /// Returns true if it did something.
    fn fetch_one(&mut self) -> Result<bool, DataError> {
        let item = match self.fetcher_state.lock().unwrap().queue.pop_front() {
            Some(item) => item,
            None => {
                debug!("Empty dequeue");
                return Ok(false);
            }
        };

        debug!("Dequeued {}", item.source);

        if (rand::random::<f64>() % 1.) > item.up.update_probability() {
            debug!(
                "Skipping update (probability {})",
                item.up.update_probability()
            );
            return Ok(true);
        }

        let domain = match Url::parse(&item.source) {
            Ok(url) => {
                let domain = url.scheme();
                domain.to_string()
            }
            Err(_) => return Ok(true),
        };

        let fetch_res = Fetcher::fetch_source(self.state.data(), None, &item.source);

        let source_uri = &item.source;

        match fetch_res {
            Ok((_, Some(hash))) => {
                debug!("Fetch for {} succeeded", source_uri);

                let source_items = self
                    .state
                    .data()
                    .lock()
                    .source_by_hash(&hash)?
                    .map(|s| s.items().ok())
                    .flatten();
                if let Some(items) = source_items {
                    debug!("Fetching items of {}", source_uri);
                    for item in items {
                        if item.is_virtual {
                            continue;
                        }

                        let mut item_uri = String::from(&domain);
                        item_uri.push_str("://");
                        item_uri.push_str(&item.path);
                        let item_uri = canonicalize_uri(&item_uri)
                            .map(|u| u.to_string())
                            .unwrap_or_default();

                        if self.maybe_fetch_one_item(source_uri, &item_uri)? {
                            thread::sleep(get_fetcher_item_wait());
                        }
                    }
                    debug!("Done fetching items for {}", source_uri);
                }
            }
            Ok((msg, None)) => {
                debug!("Fetch for {} failed", source_uri);
                for m in msg {
                    debug!("[F] {}", m.msg);
                }
            }
            Err(err) => {
                debug!("failed to fetch source {}: {}", item.source, err);
            }
        }

        Ok(true)
    }

    fn maybe_fetch_one_item(&mut self, source_uri: &str, uri: &str) -> Result<bool, DataError> {
        match Url::parse(&uri) {
            Ok(_) => {
                // let domain = url.scheme();
                // domain.to_string()
            }
            Err(_) => return Ok(false),
        };

        let needs_fetch = self
            .state
            .data()
            .lock()
            .source_item_has_versionless_user(source_uri, uri)?;
        if !needs_fetch {
            debug!(
                "Skipping fetch for item {}:{} because it's already loaded",
                source_uri, uri
            );
            return Ok(false);
        }

        debug!("Fetching one item for source {}: {}", source_uri, uri);

        // FIXME: only update item for users without a version
        // otherwise this is leaking state
        let res = Fetcher::fetch_source_item(self.state.data(), None, uri);

        match res {
            Ok(()) => (),
            Err(err) => {
                debug!("failed to fetch source item {}: {}", uri, err);
            }
        }

        Ok(true)
    }

    fn maybe_enqueue(&mut self) {
        if !self.fetcher_state.lock().unwrap().queue.is_empty() {
            return;
        }
        debug!("empty queue; enqueueing items now");

        let mut nq_count = 0;
        match self.state.data().lock().all_user_subscribed_sources() {
            Ok(sources) => {
                let mut state = self.fetcher_state.lock().unwrap();
                for source in sources {
                    let up = match get_item_up(self.state.data(), &source) {
                        Ok(up) => up,
                        Err(err) => {
                            error!("failed to enqueue source {}: {}", source, err);
                            continue;
                        }
                    };

                    debug!(
                        "enqueue: {} with probability {}",
                        source,
                        up.update_probability()
                    );

                    state.queue.push_back(FetcherJob {
                        up,
                        source: source.into(),
                    });
                    nq_count += 1;
                }
            }
            Err(err) => {
                error!("failed to enumerate user sources: {}", err);
            }
        }
        debug!("enqueue done ({} items)", nq_count);
    }
}

fn get_item_up(state: &SharedData, source: &str) -> Result<UpdateProjection, DataError> {
    let data = state.lock();
    let date_updated = data
        .latest_user_source_version(&source)?
        .map(|hash| data.source_by_hash(&hash))
        .transpose()?
        .flatten()
        .map(|source| source.date_updated().map(|s| s.to_string()))
        .flatten()
        .map(|s| parse_date(&s))
        .flatten();
    let up = match date_updated {
        Some(Date::Time(dt)) => {
            let now = Utc::now();
            let elapsed = now.signed_duration_since(dt);

            if elapsed.num_seconds() < 0 {
                UpdateProjection::default()
            } else if elapsed.num_days() < 1 {
                let weight = 65536. * (1. - elapsed.num_seconds() as f64 / 86400.);
                UpdateProjection::Hour(weight_conv(weight))
            } else if elapsed.num_weeks() < 1 {
                let weight = 65536. * (1. - elapsed.num_seconds() as f64 / 86400. / 7.);
                UpdateProjection::Day(weight_conv(weight))
            } else {
                let weight = 65536. * (1. - (elapsed.num_seconds() as f64 / 86400. / 7.) / 100.);
                UpdateProjection::Week(weight_conv(weight))
            }
        }
        Some(Date::Date(date)) => {
            let now = Utc::now().date().naive_utc();
            let elapsed = now.signed_duration_since(date);

            if elapsed.num_seconds() < 0 {
                UpdateProjection::Day(0xffff)
            } else if elapsed.num_weeks() < 1 {
                let weight = 65536. * (1. - elapsed.num_days() as f64 / 7.);
                UpdateProjection::Day(weight_conv(weight))
            } else {
                let weight = 65536. * (1. - (elapsed.num_days() as f64 / 7.) / 100.);
                UpdateProjection::Week(weight_conv(weight))
            }
        }
        None => UpdateProjection::default(),
    };
    Ok(up)
}

enum Date {
    Date(NaiveDate),
    Time(DateTime<Utc>),
}

/// Parses YYYY-MM-DD and RFC3339 dates.
fn parse_date(date: &str) -> Option<Date> {
    if date.contains("T") {
        DateTime::parse_from_rfc3339(date)
            .ok()
            .map(|d| Date::Time(d.into()))
    } else {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .ok()
            .map(|d| Date::Date(d))
    }
}

fn weight_conv(weight: f64) -> u16 {
    if weight < 0. {
        0
    } else if weight > 65535. {
        65535
    } else {
        weight as u16
    }
}
