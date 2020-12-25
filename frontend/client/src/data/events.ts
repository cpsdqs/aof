import { cache } from './cache';
import {
    IFetchResult,
    join, Key,
    parseUri,
    SOURCE,
    SOURCE_FETCH,
    SOURCE_ITEM, SOURCE_ITEM_DATA,
    SOURCE_ITEM_FETCH, SOURCES_LIST_USER
} from './paths';

const events = {
    source_fetch_did_begin: (data: { source: string }) => {
        cache.insert(join(SOURCE_FETCH, parseUri(data.source)), { loading: true });
    },
    source_fetch_did_end: (data: { source: string } & IFetchResult) => {
        const path = join(SOURCE_FETCH, parseUri(data.source));
        cache.ping(path, { loading: false, result: data });
        cache.delete(path);

        if (data.success) {
            // force reload
            cache.delete(join(SOURCE, parseUri(data.source)));
        }
    },
    source_item_fetch_did_begin: (data: { source_item: string }) => {
        cache.insert(join(SOURCE_ITEM_FETCH, parseUri(data.source_item)), { loading: true });
    },
    source_item_fetch_did_end: (data: { source_item: string } & IFetchResult) => {
        const path = join(SOURCE_ITEM_FETCH, parseUri(data.source_item));
        cache.ping(path, { loading: false, result: data });
        cache.delete(path);

        if (data.success) {
            // force reload
            cache.delete(join(SOURCE_ITEM, parseUri(data.source_item)));
            cache.delete(join(SOURCE_ITEM_DATA, parseUri(data.source_item)));
        }
    },
    user_did_subscribe_source: (data: { source: string }) => {
        if (cache.has(SOURCES_LIST_USER)) {
            const list = cache.get<Key<string[]>>(SOURCES_LIST_USER)!;
            list.push(data.source);
            cache.insert(SOURCES_LIST_USER, list);
        }
    },
    user_did_unsubscribe_source: (data: { source: string }) => {
        if (cache.has(SOURCES_LIST_USER)) {
            const list = cache.get<Key<string[]>>(SOURCES_LIST_USER)!;
            const index = list.indexOf(data.source);
            if (index !== -1) list.splice(index, 1);
            cache.insert(SOURCES_LIST_USER, list);
        }
    },
} as { [k: string]: (data: any) => void };

export function handleEvent(name: string, data: unknown) {
    if (name in events) {
        events[name](data);
    } else {
        console.warn('Ignoring unknown event type', name, data);
    }
}
