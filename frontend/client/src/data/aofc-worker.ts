// @ts-ignore
import aofc from '../../aofc/Cargo.toml';
import * as Comlink from 'comlink';

interface StorageProxy {
    get: (kind: string) => Promise<string | null>,
    set: (kind: string, value: string) => Promise<void>,
    remove: (kind: string) => Promise<void>,
}

type Callback<T, E> = (error: E, result: T) => void;
interface WorkerInterface {
    createSession: (storage: StorageProxy, clientKey: Uint8Array, cb: Callback<void, any>) => void,
    decryptKey: (sk: string) => Promise<string | null>,
    setUserPassword: (pw: string) => void,
    setPersistence: (p: string) => void,
    decrypt: (nonce: Uint8Array, buf: Uint8Array) => Uint8Array,
    encrypt: (nonce: Uint8Array, buf: Uint8Array) => Uint8Array,
}

interface Aofc {
    create_session: () => Session,
}
interface Session {
    set_persistence: (persistence: string) => void,
    set_client_key: (k: Uint8Array) => void,
    set_armored_secret_key: (sk: string) => void,
    set_secret_key_password: (pw: string) => void,
    decrypt_secret_key: () => void,
    init_from_persisted: () => void,
    maybe_persist: () => void,
    decrypt: (nonce: Uint8Array, buf: Uint8Array) => Uint8Array,
    encrypt: (nonce: Uint8Array, buf: Uint8Array) => Uint8Array,

    set_storage: (local: string, session: string) => void,
    get_storage_mutations: () => [string | null, string | null],
}

let instance: Aofc | null = null;
let session: Session | null = null;
function getInstance(): Aofc {
    if (!instance) throw new Error('no instance available');
    return instance!;
}
function get(): Session {
    if (!session) throw new Error('no session available');
    return session!;
}
let storage: StorageProxy = null as any;

async function updateStorage() {
    const session = get();
    const l = (await storage.get('local')) || '';
    const s = (await storage.get('session')) || '';
    session.set_storage(l, s);
}
async function handleStorageMutations() {
    const session = get();
    const [l, s] = session.get_storage_mutations();
    if (l) await storage.set('local', l);
    else if (l !== null) await storage.remove('local');
    if (s) await storage.set('session', s);
    else if (s !== null) await storage.remove('session');
}

Comlink.expose({
    createSession(storageProxy, clientKey) {
        return new Promise((resolve, reject) => {
            storage = storageProxy;
            aofc().then(async (aofc: any) => {
                instance = aofc;
                session = getInstance().create_session();
                await updateStorage();
                session.set_client_key(clientKey);
                session.init_from_persisted();
                await handleStorageMutations();
                resolve(null);
            }).catch((err: any) => reject(err.toString()));
        });
    },
    decryptKey: async (secretKey) => {
        const session = get();
        try {
            await updateStorage();
            session.set_armored_secret_key(secretKey);
            session.decrypt_secret_key();
            session.maybe_persist();
            await handleStorageMutations();
        } catch (err) {
            if (typeof err === 'string') return err;
            throw err;
        }
        return null;
    },
    setUserPassword(password) {
        const session = get();
        session.set_secret_key_password(password);
    },
    setPersistence(persistence) {
        const session = get();
        session.set_persistence(persistence);
    },
    decrypt(nonce, buf) {
        const session = get();
        const result = session.decrypt(nonce, buf);
        return Comlink.transfer(result, [result.buffer]);
    },
    encrypt(nonce, buf) {
        const session = get();
        const result = session.encrypt(nonce, buf);
        return Comlink.transfer(result, [result.buffer]);
    }
} as WorkerInterface);
