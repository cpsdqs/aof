export interface Load {
    toString(): string;
}
export interface Key<Data> extends Load {}
export interface FnLoad<Args, Ret, Query = void> extends Load {}

export function join<T extends FnLoad<any, any, any>>(path: T, part: FnQ<T>): FnLoad<FnA<T>, FnR<T>, []> {
    if (Array.isArray(part)) {
        return path.toString() + '/' + part.join('/');
    }
    return path.toString() + '/' + part.toString();
}

export const api = (path: string) => `../api/${path}`;

export type FnA<T> = T extends FnLoad<infer A, infer R, infer Q> ? A : never;
export type FnR<T> = T extends FnLoad<infer A, infer R, infer Q> ? R : never;
export type FnQ<T> = T extends FnLoad<infer A, infer R, infer Q> ? Q : never;
export type Fn<T> = (p: FnA<T>, ...q: string[]) => Promise<FnR<T>>;

export type AofcSessionState = {
    ready: boolean,
    decrypting_key: boolean,
    user_canceled: boolean,
    decrypting: number,
    encrypting: number,
}

export const AOFC_SESSION: Key<any> = 'aof://c_session';
export const AOFC_SESSION_STATE: Key<AofcSessionState> = 'aof://c_session_state';
export const AOFC_KEY_STORAGE = "aof:key_store";

export type PLoginType = {
    '': Fn<typeof LOGIN>,
    secret_key: Fn<typeof LOGIN_SECRET_KEY>,
    client_key: Fn<typeof LOGIN_CLIENT_KEY>,
    login: Fn<typeof LOGIN_LOGIN>,
    logout: Fn<typeof LOGIN_LOGOUT>,
    change_name: Fn<typeof LOGIN_CHANGE_NAME>,
    change_password: Fn<typeof LOGIN_CHANGE_PASSWORD>,
    delete_account: Fn<typeof LOGIN_DELETE_ACCOUNT>,
};
export const LOGIN: Key<string> = 'aof://login';
export const LOGIN_SECRET_KEY: Load = 'aof://login/secret_key';
export const LOGIN_CLIENT_KEY: Load = 'aof://login/client_key';
export const LOGIN_LOGIN: FnLoad<{
    name: string,
    password: string,
    persist: boolean,
}, void> = 'aof://login/login';
export const LOGIN_LOGOUT: Load = 'aof://login/logout';
export const LOGIN_CHANGE_NAME: FnLoad<{ name: string }, void> = 'aof://login/change_name';
export const LOGIN_CHANGE_PASSWORD: FnLoad<{ password: string, new_password: string }, void> = 'aof://login/change_password';
export const LOGIN_DELETE_ACCOUNT: FnLoad<{ password: string }, void> = 'aof://login/delete_account';

export interface IConnection {
    isOpen: boolean;
    isOpening: boolean;
    opening: Promise<void> | null;
    open(): void;
    req(name: string, data: any, onPartial?: (d: any) => void): Promise<any>;
    close(): Promise<void>;
}

export enum ConnState {
    Opening = "opening",
    Open = "open",
    Closing = "closing",
    Closed = "closed",
}

export const CONNECTION: Key<IConnection> = 'aof://connection';
export const CONNECTION_STATE: Key<ConnState> = 'aof://connection/state';
export const CONNECTION_OPEN: Load = 'aof://connection/open';
export const CONNECTION_CLOSE: Load = 'aof://connection/close';

export interface IResult {
    success: boolean,
    error: string,
}

export type DomainId = string;
export interface IDomain {
    abbrev: string,
    name: string,
    description: string,
    is_public: boolean,
    editable: boolean,
}

export type PDomainsType = {
    list_user: Fn<typeof DOMAINS_LIST_USER>,
    list_public: Fn<typeof DOMAINS_LIST_PUBLIC>,
    domain: Fn<typeof DOMAIN>,
    domain_script: Fn<typeof DOMAIN_SCRIPT>,
    create: Fn<typeof DOMAIN_CREATE>,
    update: Fn<typeof DOMAIN_UPDATE>,
    delete: Fn<typeof DOMAIN_DELETE>,
    subscribe: Fn<typeof DOMAIN_SUBSCRIBE>,
    unsubscribe: Fn<typeof DOMAIN_UNSUBSCRIBE>,
};
export const DOMAINS_LIST_USER: Key<DomainId[]> = 'aof://domains/list_user';
export const DOMAINS_LIST_PUBLIC: Key<DomainId[]> = 'aof://domains/list_public';
export const DOMAIN: FnLoad<void, IDomain | null, DomainId> = 'aof://domains/domain';
export const DOMAIN_SCRIPT: FnLoad<void, string, DomainId> = 'aof://domains/domain_script';
export const DOMAIN_CREATE: FnLoad<{
    abbrev: string,
    name: string,
}, string> = 'aof://domains/create';
export const DOMAIN_UPDATE: FnLoad<{
    id: DomainId,
    abbrev: string,
    name: string,
    description: string,
    is_public: boolean,
    script: string,
}, void> = 'aof://domains/update';
export const DOMAIN_DELETE: FnLoad<{ id: DomainId }, void> = 'aof://domains/delete';
export const DOMAIN_SUBSCRIBE: FnLoad<{ id: DomainId }, void> = 'aof://domains/subscribe';
export const DOMAIN_UNSUBSCRIBE: FnLoad<{ id: DomainId }, void> = 'aof://domains/unsubscribe';

export type SourceUri = string[];
export function parseUri(uri: string): SourceUri {
    let [domain, path] = uri.split(':///');
    if (!domain || !path) return [];
    return [domain, ...path.split('/')];
}

export interface ISource {
    loaded: boolean,
    data: ISourceData,
}
export interface ISourceData {
    data: { [k: string]: unknown },
    last_fetched: string,
    last_updated: string | null,
    items: ISourceMetaItem[],
}
export interface ISourceMetaItem {
    path: string,
    virtual: boolean,
    tags: { [k: string]: unknown },
}
export interface ISourceItem {
    loaded: boolean,
    data: ISourceItemData,
}
export interface ISourceItemData {
    last_fetched: string,
    last_updated: string | null,
}
export type SourceItemData = { [k: string]: unknown };

export type PSourcesType = {
    list_user: Fn<typeof SOURCES_LIST_USER>,
    source: Fn<typeof SOURCE>,
    source_item: Fn<typeof SOURCE_ITEM>,
    source_item_data: Fn<typeof SOURCE_ITEM_DATA>,
    source_user_data: Fn<typeof SOURCE_USER_DATA>,
    source_item_user_data: Fn<typeof SOURCE_ITEM_USER_DATA>,
    source_set_user_data: Fn<typeof SOURCE_SET_USER_DATA>,
    source_item_set_user_data: Fn<typeof SOURCE_ITEM_SET_USER_DATA>,
    subscribe: Fn<typeof SOURCE_SUBSCRIBE>,
    unsubscribe: Fn<typeof SOURCE_UNSUBSCRIBE>,
    delete: Fn<typeof SOURCE_DELETE>,
    request: Fn<typeof SOURCE_REQUEST>,
    request_item: Fn<typeof SOURCE_ITEM_REQUEST>,
};
export const SOURCES_LIST_USER: FnLoad<void, string[]> = 'aof://sources/list_user'

export const SOURCE: FnLoad<void, ISource, SourceUri> = 'aof://sources/source'
export const SOURCE_ITEM: FnLoad<void, ISourceItem, SourceUri> = 'aof://sources/source_item';
export const SOURCE_ITEM_DATA: FnLoad<void, SourceItemData, SourceUri> = 'aof://sources/source_item_data';

export interface IFetchResult {
    success: boolean,
    log: IFetchLogItem[],
}
export interface IFetchLogTime {
    real: number,
    script: number,
    fetch: number,
}
export interface IFetchLogItem {
    time?: IFetchLogTime,
    type: string,
    message: { t: string, c: any }[],
}

export interface IFetchState {
    loading: boolean,
    result?: IFetchResult,
}
export const SOURCE_FETCH: FnLoad<void, IFetchState, SourceUri> = 'aof://sources/source_fetch';
export const SOURCE_ITEM_FETCH: FnLoad<void, IFetchState, SourceUri> = 'aof://sources/source_item_fetch';

export interface IUserData {
    [k: string]: unknown,
}
export const SOURCE_USER_DATA: FnLoad<void, IUserData, SourceUri> = 'aof://sources/source_user_data';
export const SOURCE_ITEM_USER_DATA: FnLoad<void, IUserData, SourceUri> = 'aof://sources/source_item_user_data';
export const SOURCE_SET_USER_DATA: FnLoad<{
    uri: string,
    data: IUserData | null,
}, void> = 'aof://sources/source_set_user_data';
export const SOURCE_ITEM_SET_USER_DATA: FnLoad<{
    uri: string,
    data: IUserData | null,
}, void> = 'aof://sources/source_item_set_user_data';

export const SOURCE_SUBSCRIBE: FnLoad<{ uri: string }, void> = 'aof://sources/subscribe';
export const SOURCE_UNSUBSCRIBE: FnLoad<{ uri: string }, void> = 'aof://sources/unsubscribe';
export const SOURCE_DELETE: FnLoad<{ uri: string }, void> = 'aof://sources/delete';

export const SOURCE_REQUEST: FnLoad<{ uri: string }, void> = 'aof://sources/request';
export const SOURCE_ITEM_REQUEST: FnLoad<{ uri: string }, void> = 'aof://sources/request_item';
