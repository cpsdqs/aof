import { cache } from '../cache';
import * as paths from '../paths';
import { req } from '../socket';
import get from '../../locale';
import { AOFC_KEY_STORAGE, IResult } from '../paths';
import { getSession } from '../aofc';

async function verifyResponseStatus(res: Response) {
    if (!res.ok) {
        const body = await res.text();
        if (body) throw new Error(`${res.statusText}: ${body}`);
        else throw new Error(`${res.statusText}`);
    }
}

async function endSession() {
    try {
        delete localStorage[AOFC_KEY_STORAGE];
    } catch {}
    try {
        delete sessionStorage[AOFC_KEY_STORAGE];
    } catch {}

    const conn = cache.get(paths.CONNECTION);
    cache.clear(); // delete all session data
    cache.insert(paths.LOGIN, '');
    if (conn) await conn.close();
}

export default {
    '': async () => {
        const r = await fetch(paths.api('login'));
        await verifyResponseStatus(r);
        const res = await r.json();
        if (res.auth) {
            cache.insert(paths.LOGIN, res.name);
            cache.insert(paths.LOGIN_SECRET_KEY, res.secret_key);
        } else if (res.error === 'no_session') {
            cache.insert(paths.LOGIN, '');
        } else throw new Error(res.error);
    },
    secret_key: async () => {
        const res = await req('user_secret_key', null);
        cache.insert(paths.LOGIN_SECRET_KEY, res);
        return res;
    },
    client_key: async () => {
        const res = await req('user_client_key', null);
        cache.insert(paths.LOGIN_CLIENT_KEY, res);
        return res;
    },
    login: async ({ name, password, persist }) => {
        const r = await fetch(paths.api('login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password, persist }),
        });
        await verifyResponseStatus(r);
        const res = await r.json();
        if (res.success) {
            cache.insert(paths.LOGIN, res.name);
            cache.insert(paths.LOGIN_SECRET_KEY, res.secret_key);

            // try decrypting the secret key with the login password
            getSession(false, { password, persist }).catch(err => {
                console.debug(`Did not decrypt SK with login: ${err}`);
            });
        } else if (res.error === 'invalid') {
            throw new Error(get('data.login.invalid'));
        } else if (res.error === 'logged_in') {
            throw new Error(get('data.login.logged_in'));
        } else throw new Error(res.error);
    },
    logout: async () => {
        const r = await fetch(paths.api('login'), { method: 'DELETE' });
        await verifyResponseStatus(r);
        const res = await r.json();
        if (res.success) {
            await endSession();
        } else if (res.error === 'no_session') {
            throw new Error(get('data.login.no_session'));
        } else throw new Error(res.error);
    },
    change_name: async ({ name }) => {
        const res = await req<IResult>('user_change_name', { new_name: name });
        if (!res.success) {
            throw new Error(get(`data.login.cfg.${res.error}`));
        }
        cache.insert(paths.LOGIN, name);
    },
    change_password: async ({ password, new_password }) => {
        const res = await req<IResult>('user_change_password', { password, new_password });
        if (!res.success) {
            throw new Error(get(`data.login.cfg.${res.error}`));
        }
    },
    delete_account: async ({ password }) => {
        const res = await req<IResult>('user_delete', { password });
        if (!res.success) {
            throw new Error(get(`data.login.cfg.${res.error}`));
        }
        await endSession();
    },
} as paths.PLoginType;
