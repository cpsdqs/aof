import { cache } from '../cache';
import * as paths from '../paths';
import { IRssAuthKey, IResult } from '../paths';
import { req } from '../socket';

export default {
    list_user: async () => {
        const res = await req<IRssAuthKey[]>('user_rss_auth_keys', null);
        cache.insert(paths.RSS_AUTH_KEY_LIST_USER, res);
        return res;
    },
    create: async ({ label }) => {
        const res = await req<{
            success: boolean,
            key: string,
            error: string,
        }>('user_create_rss_auth_key', { label });

        if (!res.success) {
            throw new Error('???');
        }

        // TODO: delete when events impl
        cache.delete(paths.RSS_AUTH_KEY_LIST_USER);

        return res.key;
    },
    delete: async ({ key }) => {
        const res = await req<IResult>('user_delete_rss_auth_key', { key });

        if (!res.success) {
            throw new Error('???');
        }

        // TODO: delete when events impl
        cache.delete(paths.RSS_AUTH_KEY_LIST_USER);
    },
} as paths.PRssAuthKeysType;
