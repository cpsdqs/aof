import { h } from 'preact';
import { PureComponent } from 'preact/compat';
import {
    connect, connectf,
    DOMAIN, DOMAINS_LIST_USER,
    IDomain,
    ISource, IUserData,
    join,
    Key, load,
    parseUri,
    SOURCE,
    SOURCE_USER_DATA, SourceUserData
} from '../data';
import ErrorDisplay from './error-display';
import Source from './source';
import { Progress, TaskButton } from 'uikit';
import './sources.less';
import SearchBox from './search-box';
// @ts-ignore
import { quickScore } from 'quick-score';
import get from '../locale';
import { RefreshIcon } from './icons';
import { cache } from '../data/cache';

enum SearchField {
    ID_TITLE,
    DESCRIPTION,
    ITEM,
}
interface SFilterRead {
    read: boolean,
}
interface SFilterContentTags {
    tags: {
        category?: string,
        query: string,
    }[],
}
interface SourceFilterPredicates {
    read?: SFilterRead,
    contentTags?: SFilterContentTags,
}

export default class Sources<T extends string[]> extends PureComponent<Sources.Props<T>> {
    state = {
        loading: false,
        search: {
            field: SearchField.ID_TITLE,
            query: '',
        },
        filters: {} as SourceFilterPredicates,
    };

    domainsListCache: string[] = [];
    domainCache = new Map();
    sourceCache = new Map<string, ISource | null>();
    sourceUserDataCache = new Map();

    scheduledUpdate = false;
    scheduleUpdate() {
        if (this.scheduledUpdate) return;
        this.scheduledUpdate = true;
        requestAnimationFrame(() => {
            this.scheduledUpdate = false;
            this.forceUpdate();
        });
    }

    onRefresh = async () => {
        for (const uri of this.sourceCache.keys()) {
            cache.delete(join(SOURCE, parseUri(uri)));
            cache.delete(join(SOURCE_USER_DATA, parseUri(uri)));
        }
        await load(this.props.list);
    };

    render({ list, selected, onSelect, emptyMessage }: Sources.Props<T>) {
        return connect(list, view => {
            const list: string[] | null = view.get();

            let views = [];
            let contents;
            if (list) {
                let stillLoading = false;
                const filtered = !!this.state.search.query || !!Object.keys(this.state.filters).length;

                // ALRIGHT, SO this is the whole filtering logic
                // when no filter is active (filtered = false) then we want to sort
                // by last updated, so we still need to load all sources!
                const domains = new Set<string>(this.domainsListCache);
                for (const uri of list) {
                    views.push(connectf(join(SOURCE, parseUri(uri)), view => {
                        if (view.loaded && view.get() !== this.sourceCache.get(uri)) {
                            this.sourceCache.set(uri, view.get());
                            this.scheduleUpdate();
                        }
                        return null;
                    }, { key: `source-${uri}` }));
                    if (filtered) {
                        // these are only needed if we're actually filtering
                        views.push(connectf(join(SOURCE_USER_DATA, parseUri(uri)), view => {
                            if (view.get() !== this.sourceUserDataCache.get(uri)) {
                                this.sourceUserDataCache.set(uri, view.get());
                                this.scheduleUpdate();
                            }
                            return null;
                        }, { key: `source-data-${uri}` }));
                        domains.add(parseUri(uri)[0]);
                    }
                }
                let prefilteredList = list.map(uri => ({ uri, searchScore: 1, updated: '' }));

                if (filtered) {
                    views.push(connect(DOMAINS_LIST_USER, view => {
                        if (view.loaded) {
                            if (view.get() !== this.domainsListCache) {
                                this.domainsListCache = view.get() || [];
                                this.scheduleUpdate();
                            }
                        }
                        return null;
                    }, { key: 'domains list' }));

                    // also load all domains
                    for (const domain of domains) {
                        views.push(connect(join(DOMAIN, domain), view => {
                            if (view.get() !== this.domainCache.get(domain)) {
                                this.domainCache.set(domain, view.get());
                                this.scheduleUpdate();
                            }
                            return null;
                        }, { key: `domain-${domain}` }));
                    }

                    prefilteredList = [];
                    // pre-filter the list by assigning a search score and such
                    for (const uri of list) {
                        const cached = this.sourceCache.get(uri);
                        const cachedUserData = this.sourceUserDataCache.get(uri);
                        if (cached) {
                            let searchScore = 1;
                            if (this.state.search.query) {
                                searchScore = getSearchScore(uri, this.domainCache, cached, this.state.search);
                            }

                            searchScore *= filter(cached, cachedUserData, this.state.filters);

                            prefilteredList.push({
                                uri,
                                searchScore,
                                updated: '',
                            });

                        }
                        if (!cached || !cachedUserData) stillLoading = true;
                    }
                }

                // we need to set the "updated" field too
                for (const item of prefilteredList) {
                    const cached = this.sourceCache.get(item.uri);
                    if (cached && cached.data && cached.data.last_updated) {
                        item.updated = cached.data.last_updated;
                    }
                }

                if (this.state.search.query) {
                    // sort by search score if searching
                    prefilteredList = prefilteredList
                        .filter(x => x.searchScore > 0)
                        .sort((a, b) => b.searchScore - a.searchScore);
                } else {
                    // otherwise, sort by last updated
                    prefilteredList = prefilteredList
                        .filter(x => x.searchScore > 0)
                        .sort((a, b) => b.updated.localeCompare(a.updated));
                }

                let filteredList = prefilteredList.map(x => x.uri);

                if (this.state.search.field === SearchField.ID_TITLE) {
                    const uris = getExactUriSearch(this.domainCache, this.state.search.query);
                    if (uris.length) {
                        // get rid of duplicates in search results
                        filteredList = filteredList.filter(uri => !uris.includes(uri));
                        // show exact matches at the top
                        filteredList.unshift(...uris);
                    }
                }

                contents = filteredList.map(uri => (
                    <Source
                        visibilityCheck
                        key={uri}
                        uri={uri}
                        selected={selected === uri}
                        onSelect={onSelect && (() => onSelect(uri))} />
                ));

                if (!list.length && !filteredList.length) {
                    contents.push(
                        <div key="!empty" class="list-empty">
                            {emptyMessage}
                        </div>
                    );
                }

                if (stillLoading) {
                    contents.push(<Progress block />);
                }
            } else if (view.hasError) {
                contents = (
                    <ErrorDisplay error={view.getError()} />
                );
            } else {
                contents = (
                    <Progress block />
                );
            }

            return (
                <div class="sources-list">
                    <SearchBox
                        query={this.state.search.query}
                        onQueryChange={query => this.setState({
                            search: { ...this.state.search, query },
                        })} />
                    <Filters
                        filters={this.state.filters}
                        onFiltersChange={filters => this.setState({ filters })}
                        onRefresh={this.onRefresh} />
                    <div class="sources-list-null">
                        {views}
                    </div>
                    {contents}
                </div>
            );
        });
    }
}
namespace Sources {
    export interface Props<T> {
        list: Key<T>,
        selected?: string,
        onSelect?: (uri: string) => void,
        emptyMessage: string,
    }
}

function Filters({ filters, onFiltersChange, onRefresh }: {
    filters: SourceFilterPredicates,
    onFiltersChange: (f: SourceFilterPredicates) => void,
    onRefresh: () => Promise<void>,
}) {
    const onChange = (k: string, v: any) => {
        const newFilters = { ...filters } as any;
        if (!v) delete newFilters[k];
        else newFilters[k] = v;
        onFiltersChange(newFilters);
    };

    return (
        <div class="sources-filters">
            <div class="filters-bar">
                <FilterRead value={filters.read} onChange={read => onChange('read', read)} />
                <div class="refresh-container">
                    <TaskButton class="refresh-button" run={onRefresh}>
                        <RefreshIcon />
                    </TaskButton>
                </div>
            </div>
        </div>
    );
}

type FilterProps<T> = {
    value: T | null | undefined,
    onChange: (v: T | null) => void,
};
function FilterRead({ value, onChange }: FilterProps<SFilterRead>) {
    const isUnread = value && !value.read;
    const isRead = value && value.read;

    const setUnread = () => {
        if (isUnread) onChange(null);
        else onChange({ read: false });
    };
    const setRead = () => {
        if (isRead) onChange(null);
        else onChange({ read: true });
    };

    return (
        <div class="filter-read">
            <button onClick={setUnread} class={'read-switch' + (isUnread ? ' is-active' : '')}>
                {get('sources.list.filters.read.unread')}
            </button>
            <button onClick={setRead} class={'read-switch' + (isRead ? ' is-active' : '')}>
                {get('sources.list.filters.read.read')}
            </button>
        </div>
    );
}

function getExactUriSearch(
    domains: Map<string, IDomain | null>,
    query: string,
) {
    if (query.match(/^\w+:\/\/./)) {
        return [query];
    }

    const results = [];

    // replace :// and spaces with /
    query = query
        .replace(/:\/\//g, ' ')
        .replace(/ +/g, '/');
    const queryParts = query.split('/');
    if (queryParts.filter(x => x).length < 2) return [];
    const pathPart = '/' + queryParts.slice(1).join('/');

    for (const [id, item] of domains.entries()) {
        if (!item) continue;
        if (quickScore(item.abbrev, queryParts[0])) {
            results.push(id + '://' + pathPart);
        }
    }
    return results;
}

function getSearchScore(
    uri: string,
    domains: Map<string, IDomain | null>,
    source: ISource,
    search: { field: SearchField, query: string },
) {
    switch (search.field) {
        case SearchField.ID_TITLE:
            let s = 0;

            const uriParts = parseUri(uri);
            const domain = domains.get(uriParts[0]);
            if (domain) {
                const formattedUri = domain.abbrev + ' ' + uriParts.slice(1).join(' ');
                s += quickScore(formattedUri, search.query);
            }
            if (uri.includes(search.query)) {
                s += 0.5;
            }

            if (source.loaded && typeof source.data.data.title === 'string') {
                s += quickScore(source.data.data.title, search.query);
            }
            if (source.loaded && Array.isArray(source.data.data.authors)) {
                for (const author of source.data.data.authors) {
                    if (!author || typeof author?.name !== 'string') continue;
                    s += quickScore(author.name, search.query);
                }
            }
            return s;
        case SearchField.DESCRIPTION:
            if (source.loaded && source.data.data.description && typeof source.data.data.description === 'object') {
                const description = source.data.data.description as { [k: string]: unknown };
                let s = 0;
                for (const k in description) {
                    const v = description[k];
                    if (typeof v === 'string') s += quickScore(v, search.query);
                }
                return s;
            }
            return 0;
        case SearchField.ITEM:
            if (source.loaded) {
                let s = 0;
                for (const item of source.data.items) {
                    if (typeof item.tags.title === 'string') {
                        s += quickScore(item.tags.title, search.query);
                    }
                }
                return s;
            }
            return 0;
    }
}

function filter(source: ISource, userData: IUserData | null, filters: SourceFilterPredicates) {
    let result = 1;

    if (source.data && userData && filters.read) {
        const ud = new SourceUserData(userData);
        let allRead = true;
        for (const item of source.data.items) {
            if (!ud.itemReadState(item.path).read) {
                allRead = false;
                break;
            }
        }

        if (allRead !== filters.read.read) return 0;
    }
    if (source.data && filters.contentTags) {
        const data = source.data.data;
        if (!data || typeof data.content_tags !== 'object') return 0;

        const tags = data.content_tags as { [k: string]: unknown };

        const filterTags = (tags: unknown, query: string) => {
            if (!Array.isArray(tags)) return 0;
            let score = 0;
            for (const tag of tags) {
                if (!tag || typeof tag !== 'object') continue;
                score += quickScore(tag?.name);
            }
            return score;
        };

        for (const query of filters.contentTags.tags) {
            if (query.category) {
                if (!tags[query.category]) return 0;
                result *= filterTags(tags[query.category], query.query);
            } else {
                let r = 0;
                for (const category in tags) {
                    r = filterTags(tags[category], query.query);
                }
                result *= r;
            }
        }
    }
    return result;
}
