import { decode, encode } from '@msgpack/msgpack';
import { cache, partials } from '../cache';
import * as paths from '../paths';
import { req } from '../socket';
import get from '../../locale';
import {
    IResult,
    ISource,
    ISourceItem,
    join, parseUri,
    SOURCE,
    SOURCE_ITEM,
    SOURCE_ITEM_DATA, SOURCE_ITEM_USER_DATA, SOURCE_USER_DATA,
    SourceItemData, SOURCES_LIST_USER
} from '../paths';
import { decrypt, encrypt, NONCE_LENGTH } from '../aofc';
import { partialDecode } from '../partial-decode';

function makeUri(parts: string[]) {
    const domain = parts[0];
    const path = parts.slice(1).join('/');
    return domain + ':///' + path;
}

async function decryptReq(res: Uint8Array): Promise<Uint8Array> {
    const encryptedData = new Uint8Array(res);
    const nonce = encryptedData.slice(0, NONCE_LENGTH);
    const data = encryptedData.subarray(NONCE_LENGTH);
    try {
        return await decrypt(nonce, data, true);
    } catch (err) {
        if (typeof err === 'string') throw new Error(get(`data.crypto.${err}`));
        throw err;
    }
}

async function encryptReq(data: Uint8Array): Promise<Uint8Array> {
    try {
        const nonce = new Uint8Array(NONCE_LENGTH);
        window.crypto.getRandomValues(nonce);
        const encrypted = await encrypt(nonce, new Uint8Array(data));
        const buffer = new Uint8Array(nonce.length + encrypted.length);
        buffer.set(nonce, 0);
        buffer.set(encrypted, NONCE_LENGTH);
        return buffer;
    } catch (err) {
        if (typeof err === 'string') throw new Error(get(`data.crypto.${err}`));
        throw err;
    }
}

export default {
    list_user: async () => {
        const res = await req<string[]>('user_sources', null);
        cache.insert(SOURCES_LIST_USER, res);
        return res;
    },
    source: async (_, ...parts) => {
        const res = await req<ISource>('source', { uri: makeUri(parts) });
        cache.insert(join(SOURCE, parts), res);
        return res;
    },
    source_item: async (_, ...parts) => {
        const res = await req<ISourceItem>('source_item', { uri: makeUri(parts) });
        cache.insert(join(SOURCE_ITEM, parts), res);
        return res;
    },
    source_item_data: async (_, ...parts) => {
        const cacheKey = join(SOURCE_ITEM_DATA, parts);
        const res = await req<SourceItemData>('source_item_data', { uri: makeUri(parts) }, data => {
            try {
                const partial = partialDecode(data);
                partials.insert(cacheKey, partial);
            } catch {
                // nothing
            }
        });
        cache.insert(cacheKey, res);
        return res;
    },
    source_user_data: async (_, ...parts) => {
        const res = await req<Uint8Array>('source_user_data', { uri: makeUri(parts) });
        let data;
        if (res && res.length > NONCE_LENGTH) data = await decryptReq(res);
        else data = res;
        const decoded = data && data.length ? decode(data) : {};
        if (!decoded || typeof decoded !== 'object') throw new Error('user data is not an object');
        cache.insert(join(SOURCE_USER_DATA, parts), decoded);
        return decoded;
    },
    source_item_user_data: async (_, ...parts) => {
        const res = await req<Uint8Array>('source_item_user_data', { uri: makeUri(parts) });
        let data;
        if (res && res.length > NONCE_LENGTH) data = await decryptReq(res);
        else data = res;
        const decoded = data && data.length ? decode(data) : {};
        if (!decoded || typeof decoded !== 'object') throw new Error('user data is not an object');
        cache.insert(join(SOURCE_ITEM_USER_DATA, parts), decoded);
        return decoded;
    },
    source_set_user_data: async ({ uri, data }) => {
        const res = await req<IResult>('set_source_user_data', {
            uri,
            data: await encryptReq(data ? new Uint8Array(encode(data)) : new Uint8Array()),
        });
        if (!res.success) {
            throw new Error(get(`data.sources.${res.error}`));
        }
        cache.insert(join(SOURCE_USER_DATA, parseUri(uri)), data);
    },
    source_item_set_user_data: async ({ uri, data }) => {
        const res = await req<IResult>('set_source_item_user_data', {
            uri,
            data: await encryptReq(data ? new Uint8Array(encode(data)) : new Uint8Array()),
        });
        if (!res.success) {
            throw new Error(get(`data.sources.${res.error}`));
        }
        cache.insert(join(SOURCE_USER_DATA, parseUri(uri)), data);
    },
    subscribe: async ({ uri }) => {
        const res = await req<IResult>('user_subscribe_source', { uri });
        if (!res.success) {
            throw new Error(get(`data.sources.${res.error}`));
        }
    },
    unsubscribe: async ({ uri }) => {
        const res = await req<IResult>('user_unsubscribe_source', { uri });
        if (!res.success) {
            throw new Error(get(`data.sources.${res.error}`));
        }
    },
    delete: async ({ uri }) => {
        const res = await req<IResult>('user_delete_source', { uri });
        if (!res.success) throw new Error(get(`data.sources.${res.error}`));
        cache.delete(join(SOURCE, parseUri(uri)));
    },
    request: async ({ uri }) => {
        const res = await req<IResult>('user_request_source', { uri });
        if (!res.success) {
            throw new Error(get(`data.sources.${res.error}`));
        }
    },
    request_item: async ({ uri }) => {
        const res = await req<IResult>('user_request_source_item', { uri });
        if (!res.success) {
            throw new Error(get(`data.sources.${res.error}`));
        }
    },
} as paths.PSourcesType;
