// copied from https://github.com/denoland/deno/blob/4f46dc999b9fd3f26b6586d06d099d7039ca35c8/cli/rt/99_main.js
// TODO: more apis

((window) => {
    const eventTarget = window.__bootstrap.eventTarget;
    const globalInterfaces = window.__bootstrap.globalInterfaces;
    const dispatchMinimal = window.__bootstrap.dispatchMinimal;
    const build = window.__bootstrap.build;
    const version = window.__bootstrap.version;
    const errorStack = window.__bootstrap.errorStack;
    const os = window.__bootstrap.os;
    const timers = window.__bootstrap.timers;
    const worker = window.__bootstrap.worker;
    const signals = window.__bootstrap.signals;
    const performance = window.__bootstrap.performance;
    const crypto = window.__bootstrap.crypto;
    const url = window.__bootstrap.url;
    const headers = window.__bootstrap.headers;
    const streams = window.__bootstrap.streams;
    const fileReader = window.__bootstrap.fileReader;
    const webSocket = window.__bootstrap.webSocket;
    const fetch = window.__bootstrap.fetch;
    const prompt = window.__bootstrap.prompt;

    function nonEnumerable(v) {
        return { enumerable: false, writable: true, configurable: true, value: v };
    }
    function writable(v) {
        return { writable: true, enumerable: true, configurable: true, value: v };
    }
    function readOnly(v) {
        return { value: v };
    }

    const globalScope = {
        CloseEvent: nonEnumerable(CloseEvent),
        CustomEvent: nonEnumerable(CustomEvent),
        DOMException: nonEnumerable(DOMException),
        ErrorEvent: nonEnumerable(ErrorEvent),
        Event: nonEnumerable(Event),
        EventTarget: nonEnumerable(EventTarget),
        FileReader: nonEnumerable(fileReader.FileReader),
        MessageEvent: nonEnumerable(MessageEvent),
        ProgressEvent: nonEnumerable(ProgressEvent),
        TextDecoder: nonEnumerable(TextDecoder),
        TextEncoder: nonEnumerable(TextEncoder),
        URL: nonEnumerable(url.URL),
        atob: writable(atob),
        btoa: writable(btoa),
        // clearInterval: writable(timers.clearInterval),
        // clearTimeout: writable(timers.clearTimeout),
        crypto: readOnly(crypto),
        // setInterval: writable(timers.setInterval),
        // setTimeout: writable(timers.setTimeout),
    };
    Object.defineProperties(window, globalScope);

    delete globalThis.__bootstrap;
})(globalThis);
