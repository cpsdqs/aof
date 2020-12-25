import { EventEmitter } from 'uikit';

export const b = path => (document.head.dataset.base || '') + path;

function fetchJson(...args) {
    return fetch(...args).then(res => {
        if (!res.ok) {
            return res.text().then(async (text) => {
                throw new Error('HTTP error ' + res.status + ': ' + text);
            });
        }
        return res.json();
    });
}

export function isTokenValid(token) {
    const etoken = encodeURIComponent(token);
    return fetchJson(b(`api/registration/is_valid_token?token=${etoken}`));
}

export function isNameAvailable(token, name) {
    const etoken = encodeURIComponent(token);
    const ename = encodeURIComponent(name);
    return fetchJson(b(`api/registration/is_name_available?token=${etoken}&name=${ename}`));
}

export function register(token, name, password, secret_key) {
    return fetchJson(b('api/registration/register'), {
        method: 'POST',
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password, secret_key }),
    });
}

export function session() {
    return fetchJson(b('api/login'));
}

export function login(name, password) {
    return fetchJson(b('api/login'), {
        method: 'POST',
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password, persist: false }),
    });
}

export function logout() {
    return fetchJson(b('api/login'), {
        method: 'DELETE',
    });
}

export const loginEvents = new EventEmitter();
