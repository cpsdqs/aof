import { EventEmitter } from 'uikit';
// @ts-ignore
import base from '../locales/en.cson';
const BASE_LOCALE = 'en';

const locales: { [key: string]: (() => Promise<object>)|undefined } = {
    // @ts-ignore
    de: () => import('../locales/de.cson'),
};

export const availableLocales = [BASE_LOCALE].concat(Object.keys(locales)).sort();

// the locale as determined using the navigator settings
let navigatorLocale = BASE_LOCALE;
{
    // try pick a language based on the user's language settings
    const languages = navigator.languages || [navigator.language];

    for (const _lang of languages) {
        const lang = _lang.toLowerCase();
        const parts = lang.split('-');
        const langOnly = parts[0];

        if (availableLocales.includes(lang)) {
            navigatorLocale = lang;
            break;
        }
        if (availableLocales.includes(langOnly)) {
            navigatorLocale = langOnly;
            break;
        }
    }
}

let currentLocale = 'en';
export const current = {
    get() {
        return currentLocale;
    },
    set(l: string) {
        currentLocale = l;
        if (window.localStorage) {
            if (l === navigatorLocale) delete window.localStorage.aof_locale;
            else window.localStorage.aof_locale = l;
        }
        return loadLocale(l).then(() => {
            if (l === currentLocale) localeUpdate.emit('update');
        });
    }
};
export const localeUpdate = new EventEmitter();

const loadingLocales: { [key: string]: Promise<void>|undefined } = {};
const loadedLocales: { [key: string]: object|undefined } = {};

async function loadLocale(locale: string) {
    if (locale === BASE_LOCALE) return;
    if (loadedLocales[locale]) return;
    if (!loadingLocales[locale]) {
        const load = locales[locale];
        if (!load) throw new Error(`No such locale: ${locale}`);

        loadingLocales[locale] = load().then(data => {
            loadedLocales[locale] = data;
        }).catch((err: any) => {
            console.error(`Failed to load locale data for ${locale}`, err);
            loadingLocales[locale] = undefined;
        });
        await loadingLocales[locale];
    }
}

{
    // set locale
    let didSet = false;
    if (window.localStorage && window.localStorage.aof_locale) {
        const locale = window.localStorage.aof_locale;
        if (availableLocales.includes(locale)) {
            current.set(locale);
            didSet = true;
        }
    }

    if (!didSet) {
        current.set(navigatorLocale);
    }
}

function getLocale(locale: string) {
    if (locale === BASE_LOCALE) return base;
    if (loadedLocales[locale]) return loadedLocales[locale];
    loadLocale(locale);
    return null;
}

function getKey(data: any, keyParts: string[]): string|object|null {
    if (data === undefined) return null;
    if (!keyParts.length) return data;
    const keyPart = keyParts[0];
    return getKey(data[keyPart], keyParts.slice(1));
}

function format(string: string, args: Stringifiable[]) {
    return string.replace(/{\d+}/g, m => {
        const index = +m.substring(1, m.length - 1);
        return (index in args) ? args[index].toString() : '?';
    });
}

interface Stringifiable {
    toString(): string;
}

export default function get(name: string, ...args: Stringifiable[]) {
    let current = getLocale(currentLocale) || base;

    let str = getKey(current, name.split('.'));
    if (typeof str !== 'string') str = getKey(base, name.split('.'));
    if (typeof str !== 'string') return name;
    return format(str, args);
}
