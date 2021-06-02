import { Key } from './paths';

// partial data times out after 10 seconds
const PARTIAL_TIMEOUT = 10000;

/// Cache data
const cacheData = new Map();
const partialData = new Map();

/// Map<cache key, Set<views>> - list of views for a cache key
export const views = new Map();

function insert<K extends Key<any>>(key: K, value: (K extends Key<infer T> ? T : never) | null) {
    partialData.delete(key);
    cacheData.set(key, value);
    if (views.has(key)) {
        for (const view of views.get(key)) {
            view.notify();
        }
    }
}

function ping<K extends Key<any>>(key: K, value: (K extends Key<infer T> ? T : never)) {
    if (views.has(key)) {
        for (const view of views.get(key)) {
            view.ping(value);
        }
    }
}

function get<K extends Key<any>>(key: K): (K extends Key<infer T> ? T : never) | null {
    if (!cacheData.has(key)) return null;
    return cacheData.get(key);
}

function insertPartial<K extends Key<any>>(key: K, value: (K extends Key<infer T> ? T : never) | null) {
    partialData.set(key, { time: Date.now(), value });
    if (views.has(key)) {
        for (const view of views.get(key)) {
            if (view.usePartials) view.notify();
        }
    }
}

function getPartial<K extends Key<any>>(key: K): (K extends Key<infer T> ? T : never) | null {
    const item = partialData.get(key);
    if (!item || item.time < Date.now() - PARTIAL_TIMEOUT) return null;
    return item.value;
}

function deleteKey(key: Key<any>) {
    cacheData.delete(key);
    if (views.has(key)) {
        for (const view of views.get(key)) {
            view.notify();
        }
    }
}

export const cache = {
    clear() {
        cacheData.clear();
    },
    has(key: Key<any>) {
        return cacheData.has(key);
    },
    get,
    insert,
    ping,
    delete: deleteKey,
};

export const partials = {
    has(key: Key<any>) {
        return partialData.has(key);
    },
    get: getPartial,
    insert: insertPartial,
};

export const __cache_debug = {
    cache,
    cacheData,
};

{
    const CACHE_CLEAR_INTERVAL = 1000000;
    let clearing = false;

    function clearUnusedCacheKeys() {
        if (clearing) return;
        clearing = true;

        const usedKeys = new Set();
        const unusedViewKeys = new Set();
        for (const [k, v] of views) {
            if (v.size) {
                usedKeys.add(k);
            } else {
                unusedViewKeys.add(k);
            }
        }
        for (const k of cacheData.keys()) {
            if (!usedKeys.has(k)) cacheData.delete(k);
        }
        for (const k of unusedViewKeys) {
            views.delete(k);
        }

        clearing = false;
        setTimeout(clearUnusedCacheKeys, CACHE_CLEAR_INTERVAL);
    }

    clearUnusedCacheKeys();
}
