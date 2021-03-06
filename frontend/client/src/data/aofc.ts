import * as Comlink from 'comlink';
// @ts-ignore
import aofcWorkerURL from 'omt:./aofc-worker.ts';
import { cache } from './cache';
import {
    AOFC_KEY_STORAGE,
    AOFC_SESSION,
    AOFC_SESSION_STATE,
    LOGIN_CLIENT_KEY,
    LOGIN_SECRET_KEY,
    AofcSessionState,
} from './paths';
import DecryptionPrompt from '../components/decryption-prompt';
import get from '../locale';
import { req } from './socket';

function createStorageProxy() {
    return {
        get: (kind: string) => {
            if (kind === 'local') return localStorage.getItem(AOFC_KEY_STORAGE);
            if (kind === 'session') return sessionStorage.getItem(AOFC_KEY_STORAGE);
        },
        set: (kind: string, value: string) => {
            localStorage.removeItem(AOFC_KEY_STORAGE);
            sessionStorage.removeItem(AOFC_KEY_STORAGE);
            if (kind === 'local') localStorage.setItem(AOFC_KEY_STORAGE, value);
            if (kind === 'session') sessionStorage.setItem(AOFC_KEY_STORAGE, value);
        },
        remove: (kind: string) => {
            if (kind === 'local') localStorage.removeItem(AOFC_KEY_STORAGE);
            if (kind === 'session') sessionStorage.removeItem(AOFC_KEY_STORAGE);
        },
    };
}

function updateState(map: (s: AofcSessionState) => AofcSessionState) {
    cache.insert(AOFC_SESSION_STATE, map(cache.get(AOFC_SESSION_STATE) || {
        ready: false,
        decrypting_key: false,
        user_canceled: false,
        decrypting: 0,
        encrypting: 0,
    }));
}

async function loadKey(apiPath: string, cachePath: typeof LOGIN_CLIENT_KEY): Promise<Uint8Array> {
    const cachedKey = cache.get(cachePath) as Uint8Array;
    if (cachedKey) return cachedKey;
    const key = await req<Uint8Array>(apiPath, null);
    cache.insert(cachePath, key);
    return key;
}

type SessionFromLogin = {
    password: string,
    persist: boolean,
};

export async function getSession(userInitiated?: boolean, login?: SessionFromLogin) {
    if (!cache.has(AOFC_SESSION)) {
        cache.insert(AOFC_SESSION, Promise.resolve(null).then(async () => {
            if (!userInitiated && cache.get(AOFC_SESSION_STATE)?.user_canceled) {
                throw new Error(get('login.decrypt.errors.canceled'));
            }

            updateState(s => ({ ...s, decrypting_key: true }));
            const clientKey = await loadKey('user_client_key', LOGIN_CLIENT_KEY);
            if (clientKey.length !== 32) throw new Error('client key has incorrect size');

            const aofc = Comlink.wrap(new Worker(aofcWorkerURL)) as any;
            await aofc.createSession(Comlink.proxy(createStorageProxy()), clientKey);

            const secretKey = await loadKey('user_secret_key', LOGIN_SECRET_KEY);
            if (!secretKey) throw new Error('Could not obtain secret key!');
            let error = await aofc.decryptKey(secretKey);
            if (error) {
                if (login) {
                    await aofc.setUserPassword(login.password);
                    // SECURITY: if the user's SK password is the same as their login password, then
                    // I think it would be safe to assume they don’t mind it being persisted to
                    // local storage or session storage.
                    await aofc.setPersistence(login.persist ? 'local' : 'session');
                    const error = await aofc.decryptKey(secretKey);
                    if (error) throw new Error(get(`login.decrypt.errors.${error}`));
                } else {
                    try {
                        await DecryptionPrompt.run(async (password, persistence) => {
                            await aofc.setUserPassword(password);
                            await aofc.setPersistence(persistence);
                            const error = await aofc.decryptKey(secretKey);
                            if (error) throw new Error(get(`login.decrypt.errors.${error}`));
                        });
                    } catch (err) {
                        if (err.name === 'user_canceled') updateState(s => ({ ...s, user_canceled: true }));
                        throw err;
                    }
                }
            }
            updateState(s => ({ ...s, ready: true, decrypting_key: false, user_canceled: false }));
            return {
                link: aofc,
                isUsable: true,
            };
        }).catch(err => {
            cache.delete(AOFC_SESSION);
            updateState(s => ({ ...s, decrypting_key: false }));
            throw err;
        }));
    }
    return await cache.get(AOFC_SESSION);
}

let currentlyDecryptingKey: Promise<void> | null = null;
async function decryptKey() {
    if (!currentlyDecryptingKey) {
        currentlyDecryptingKey = Promise.resolve().then(async () => {
            return [];
        }).catch(err => {
            return [err];
        }).then(err => {
            currentlyDecryptingKey = null;
            if (err.length) throw err[0];
        });
    }
    await currentlyDecryptingKey;
}

export const NONCE_LENGTH = 12;

export async function decrypt(nonce: Uint8Array, buffer: Uint8Array, consume?: boolean): Promise<Uint8Array> {
    updateState(s => ({ ...s, decrypting: s.decrypting + 1 }));
    try {
        const session = await getSession();
        if (!session.isUsable) await decryptKey();

        let buf = buffer;
        if (consume) buf = Comlink.transfer(buffer, [buffer.buffer]);

        return await session.link.decrypt(nonce, buf);
    } catch (err) {
        throw err;
    } finally {
        updateState(s => ({ ...s, decrypting: s.decrypting - 1 }));
    }
}
export async function encrypt(nonce: Uint8Array, buffer: Uint8Array, consume?: boolean): Promise<Uint8Array> {
    updateState(s => ({ ...s, encrypting: s.encrypting + 1 }));
    try {
        const session = await getSession();
        if (!session.isUsable) await decryptKey();

        let buf = buffer;
        if (consume) buf = Comlink.transfer(buffer, [buffer.buffer]);

        return await session.link.encrypt(nonce, buf);
    } catch (err) {
        throw err;
    } finally {
        updateState(s => ({ ...s, encrypting: s.encrypting - 1 }));
    }
}
