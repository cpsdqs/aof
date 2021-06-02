{
    try {
        Deno.core.registerErrorClass("Error", Error);
    } catch {}

    const METHODS = [
        'GET',
        'HEAD',
        'POST',
        'PATCH',
        'TRACE',
        'DELETE',
        'OPTIONS',
        'CONNECT',
    ];
    const REDIRECTS = [
        'follow',
        'error',
        'manual',
    ];

    /* globalThis.TextEncoder = class TextEncoder {
        encode(string) {
            return Deno.core.encode(string);
        }
        encodeInto(string, buf) {
            const encoded = Deno.core.encode(string);
            buf.set(encoded, 0);
        }
    };
    globalThis.TextDecoder = class TextDecoder {
        decode(buf) {
            if (isTypedArray(buf) || buf instanceof ArrayBuffer) {
                buf = new Uint8Array(buf);
            } else {
                throw new TypeError('Expected buf to be a typed array or array buffer');
            }
            return Deno.core.decode(buf);
        }
    }; */

    function isTypedArray(value) {
        return (value instanceof Int8Array) ||
            (value instanceof Uint8Array) ||
            (value instanceof Uint8ClampedArray) ||
            (value instanceof Int16Array) ||
            (value instanceof Uint16Array) ||
            (value instanceof Int32Array) ||
            (value instanceof Uint32Array) ||
            (value instanceof BigInt64Array) ||
            (value instanceof BigUint64Array) ||
            (value instanceof Float32Array) ||
            (value instanceof Float64Array);
    }

    const bufferData = new WeakMap();
    globalThis.Blob = class Blob {
        #buffer;
        #type = '';

        constructor(array, options) {
            if (!Array.isArray(array)) throw new TypeError('Expected first argument to be an array');
            const itemBuffers = [];
            for (const item of array) {
                if (item instanceof ArrayBuffer) {
                    itemBuffers.push(new Uint8Array(item));
                } else if (isTypedArray(item)) {
                    itemBuffers.push(new Uint8Array(item));
                } else if (item instanceof Blob) {
                    itemBuffers.push(bufferData.get(item));
                } else if (typeof item === 'string') {
                    itemBuffers.push(new TextEncoder().encode(item));
                } else {
                    throw new TypeError('Invalid item type');
                }
            }

            const len = itemBuffers.map(x => x.byteLength).reduce((a, b) => a + b, 0);
            this.#buffer = new Uint8Array(len);
            let cursor = 0;
            for (const item of itemBuffers) {
                this.#buffer.set(item, cursor);
                cursor += item.byteLength;
            }

            if (options) {
                if (typeof options !== 'object') throw new TypeError('Expected second argument to be an object');
                if ('type' in options) {
                    if (typeof options.type !== 'string') throw new TypeError('Expected type to be a string');
                    this.#type = options.type;
                }
            }

            bufferData.set(this, this.#buffer);
        }

        get size() {
            return this.#buffer.byteLength;
        }
        get type() {
            return this.#type;
        }

        arrayBuffer() {
            // TODO: make immutable
            return Promise.resolve(this.#buffer.buffer);
        }

        slice(a, b, contentType = '') {
            return new Blob([this.#buffer.slice(a, b)], { type: contentType });
        }

        stream() {
            return blobToReadableStream(this);
        }

        text() {
            const td = new TextDecoder();
            return Promise.resolve(td.decode(this.#buffer));
        }
    };

    globalThis.FormData = class FormData {
        // TODO
    };

    /* globalThis.URLSearchParams = class URLSearchParams {
        // TODO
    }; */

    const streamData = new WeakMap();

    class ReadableByteStreamController {
        constructor(stream) {
            throw new Error('readable byte stream controller not implemented');
        }
    }

    class ReadableStreamDefaultController {
        #stream;
        constructor(stream) {
            this.#stream = stream;
        }

        get desiredSize() {
            return 1;
        }

        enqueue(chunk) {
            streamData.get(this.#stream).enqueue(chunk);
        }

        error(e) {
            streamData.get(this.#stream).error(e);
        }

        close() {
            streamData.get(this.#stream).close();
        }
    }
    class ReadableStreamDefaultReader {
        #stream;
        constructor(stream) {
            this.#stream = stream;
        }

        get closed() {
            if (!this.#stream) return true;
            streamData.get(this.#stream).isClosed();
        }

        cancel(reason) {
            if (!this.#stream) return Promise.resolve(reason);
            return this.#stream.cancel(reason);
        }

        read() {
            if (!this.#stream) return Promise.resolve({ value: null, done: true });
            return streamData.get(this.#stream).dequeue();
        }

        releaseLock() {
            streamData.get(this.#stream).releaseLock();
            this.#stream = null;
        }
    }

    class ReadableStreamBYOBReader {
        constructor(stream) {
            throw new Error('BYOB reader not implemented');
        }
    }

    globalThis.ReadableStream = class ReadableStream {
        #controller;
        #source;
        #error = null;
        #currentReader = null;
        #isClosed = false;
        #isBodyUsed = false;

        constructor(underlyingSource, queueingStrategy) {
            if (typeof underlyingSource !== 'object') throw new TypeError('Expected first argument to be an object');
            if (typeof underlyingSource.start !== 'function') throw new TypeError('Expected first argument to have the `start` method');

            let type = 'default';
            if (underlyingSource.type === 'bytes') type = 'bytes';

            if (type === 'default') {
                this.#controller = new ReadableStreamDefaultController(this);
            } else {
                this.#controller = new ReadableByteStreamController(this);
            }

            this.#source = underlyingSource;

            let lastEvent = null;
            let eventQueue = [];
            let canPushChunk = true;
            let listenerQueue = [];
            const pushEvent = (event) => {
                if (event.type === 'chunk' && canPushChunk) {
                    const cb = listenerQueue.shift();
                    if (cb) cb.resolve({ value: event.chunk, done: false });
                    else eventQueue.push(event);
                } else if (event.type === 'error') {
                    canPushChunk = false;
                    for (const cb of listenerQueue) listenerQueue.reject(event.error);
                    lastEvent = event;
                    listenerQueue = [];
                } else if (event.type === 'close') {
                    canPushChunk = false;
                    for (const cb of listenerQueue) listenerQueue.resolve({ value: null, done: true });
                    lastEvent = event;
                    listenerQueue = [];
                }
            };

            streamData.set(this, {
                close: () => {
                    this.#isClosed = true;
                    pushEvent({ type: 'close' });
                },
                error: (error) => {
                    this.#error = { error };
                    this.#isClosed = true;
                    pushEvent({ type: 'error', error });
                },
                enqueue: (chunk) => {
                    pushEvent({ type: 'chunk', chunk });
                },
                isClosed: () => {
                    return this.#isClosed;
                },
                dequeue: () => {
                    this.#isBodyUsed = true; // FIXME: is this right?
                    if (eventQueue.length || lastEvent) {
                        const event = eventQueue.length ? eventQueue.shift() : lastEvent;
                        if (event.type === 'error') return Promise.reject(event.error);
                        else if (event.type === 'close') return Promise.resolve({ value: null, done: true });
                        else if (event.type === 'chunk') return Promise.resolve({ value: event.chunk, done: false });
                    } else {
                        return new Promise((resolve, reject) => listenerQueue.push([resolve, reject]));
                    }
                },
                releaseLock: () => {
                    if (listenerQueue.length) throw new TypeError('Cannot release lock with pending read');
                    this.#currentReader = null;
                },
                isBodyUsed: () => {
                    return this.#isBodyUsed;
                },
            });

            underlyingSource.start(this.#controller);
        }

        get locked() {
            return !!this.#currentReader;
        }

        async cancel(reason) {
            if (this.locked) throw new TypeError('Cannot cancel locked stream');
            if (this.#source.cancel) await this.#source.cancel(reason);
            this.#isClosed = true;
            return reason;
        }

        getReader(mode) {
            if (this.locked) throw new TypeError('Stream is already being read');
            if (mode === 'byob') {
                this.#currentReader = new ReadableStreamBYOBReader(this);
            } else if (mode === undefined) {
                this.#currentReader = new ReadableStreamDefaultReader(this);
            } else {
                throw new RangeError('Unexpected reader mode');
            }
            return this.#currentReader;
        }
    };

    function blobToReadableStream(blob) {
        return new ReadableStream({
            start(controller) {
                const CHUNK_SIZE = 2048;
                let cursor = 0;
                const buffer = bufferData.get(blob);
                while (cursor < buffer.byteLength) {
                    const chunk = buffer.subarray(cursor, cursor + CHUNK_SIZE);
                    controller.enqueue(chunk);
                    cursor += CHUNK_SIZE;
                }
                controller.close();
            }
        });
    }

    async function readableStreamToBuffer(stream) {
        const reader = stream.getReader();
        let bufs = [];
        while (true) {
            const res = await reader.read();
            if (res.done) break;
            else bufs.push(res.value);
        }
        return await new Blob(bufs).arrayBuffer();
    }

    // TODO: set Headers guard instead of using Object.freeze
    // TODO: proper multiple-values behavior
    globalThis.Headers = class Headers {
        #headers = new Map();

        constructor(init) {
            if (init instanceof Headers) {
                // TODO
            } else if (typeof init === 'object') {
                for (const k in init) {
                    this.append(k, init[k]);
                }
            }
        }

        append(name, value) {
            if (typeof name !== 'string') throw new TypeError('Expected header name to be a string');
            if (typeof value !== 'string') throw new TypeError('Expected header value to be a string');
            name = name.toLowerCase();
            let newValue = value;
            if (this.#headers.has(name)) {
                newValue = this.#headers.get(name) + ', ' + value;
            }
            this.#headers.set(name, newValue);
        }

        has(name) {
            if (typeof name !== 'string') throw new TypeError('Expected header name to be a string');
            name = name.toLowerCase();
            return this.#headers.has(name);
        }

        get(name) {
            if (typeof name !== 'string') throw new TypeError('Expected header name to be a string');
            name = name.toLowerCase();
            return this.#headers.get(name) || null;
        }

        delete(name) {
            if (typeof name !== 'string') throw new TypeError('Expected header name to be a string');
            name = name.toLowerCase();
            this.#headers.delete(name);
        }

        set(name, value) {
            if (typeof name !== 'string') throw new TypeError('Expected header name to be a string');
            if (typeof value !== 'string') throw new TypeError('Expected header value to be a string');
            name = name.toLowerCase();
            this.#headers.set(name, value);
        }

        *keys() {
            for (const key of this.#headers.keys()) yield key;
        }

        *values() {
            for (const value of this.#headers.values()) yield value;
        }

        *entries() {
            for (const entry of this.#headers) {
                yield entry;
            }
        }

        [Symbol.iterator]() {
            return this.entries();
        }
    };

    const requestGetInfoString = Symbol();
    globalThis.Request = class Request {
        #url = '';
        #method = 'GET';
        #headers = new Headers();
        #redirect = 'follow';
        #referrer = 'about:client';
        #body;

        get cache() {
            return 'default';
        }
        get credentials() {
            return 'same-origin';
        }
        get destination() {
            return '';
        }
        get headers() {
            return this.#headers;
        }
        get integrity() {
            return '';
        }
        get method() {
            return this.#method;
        }
        get mode() {
            return 'cors';
        }
        get redirect() {
            return this.#redirect;
        }
        get referrer() {
            return this.#referrer;
        }
        get referrerPolicy() {
            return '';
        }
        get url() {
            return this.#url;
        }
        get body() {
            return this.#body;
        }
        get bodyUsed() {
            return streamData.get(this.#body).isBodyUsed();
        }

        constructor(input, init) {
            if (input instanceof Request) {
                // TODO: copy
                this.#url = input.url;
                this.#method = input.method;
                this.#headers = new Headers(input.headers);
                this.#body = input.body;
                this.#redirect = input.redirect;
                this.#referrer = input.referrer;
            } else if (typeof input === 'string') {
                this.#url = input;
            } else {
                throw new Error('Expected first argument to be string or Request');
            }

            if (init) {
                if (typeof init !== 'object') throw new TypeError('Expected second argument to be an object');
                if ('method' in init) {
                    if (!METHODS.includes(init.method)) throw new TypeError(`Invalid method “${init.method}”`);
                    this.#method = init.method;
                }
                if ('headers' in init) {
                    if (typeof init.headers !== 'object') throw new TypeError('Expected headers to be an object');
                    if (init.headers instanceof Headers) {
                        this.#headers = new Headers(init.headers);
                    } else {
                        for (const k in init.headers) this.#headers.append(k, init.headers[k]);
                    }
                }
                if ('body' in init) {
                    const body = init.body;
                    if (typeof body instanceof Blob) {
                        this.#body = blobToReadableStream(body);
                    } else if (typeof body === 'string') {
                        this.#body = blobToReadableStream(new Blob([body]));
                    } else if ((body instanceof ArrayBuffer) || isTypedArray(body)) {
                        this.#body = blobToReadableStream(new Blob([body]));
                    } else if (body instanceof FormData) {
                        // TODO
                        throw new Error('FormData body not implemented');
                    } else if (body instanceof URLSearchParams) {
                        // TODO
                        throw new Error('URLSearchParams body not implemented');
                    } else if (body instanceof ReadableStream) {
                        this.#body = body;
                    } else {
                        throw new TypeError('Unexpected body type');
                    }
                }
                if ('mode' in init) {
                    // not used here
                }
                if ('credentials' in init) {
                    // not used here
                    console.warn('Ignoring credentials option in fetch (not supported)');
                }
                if ('cache' in init) {
                    // not used here
                }
                if ('redirect' in init) {
                    if (!REDIRECTS.includes(init.redirect)) throw new TypeError('Invalid redirect mode');
                    this.#redirect = init.redirect;
                }
                if ('referrer' in init) {
                    this.#referrer = init.referrer;
                }
                if ('integrity' in init) {
                    // not used here
                    console.warn('Ignoring integrity option in fetch (not supported)');
                }
            }

            if (!this.#body) this.#body = blobToReadableStream(new Blob([]));

            Object.freeze(this.#headers);
        }
    };

    const secretResponseInit = Symbol();
    globalThis.Response = class Response {
        #body = null;
        #headers = new Headers();
        #redirected = false;
        #status = 200;
        #statusText = '';
        #type = 'default';
        #url;

        constructor(body, init) {
            if (body instanceof Blob) {
                this.#body = blobToReadableStream(body);
            } else if (isTypedArray(body)) {
                this.#body = blobToReadableStream(new Blob([body]));
            } else if (body instanceof FormData) {
                throw new Error('FormData not supported');
            } else if (body instanceof ReadableStream) {
                this.#body = body;
            } else if (body instanceof URLSearchParams) {
                throw new Error('URLSearchParams not supported');
            } else if (typeof body === 'string') {
                this.#body = blobToReadableStream(new Blob([body]));
            } else if (body) {
                throw new TypeError('Unexpected body type');
            }

            if (init) {
                if ('status' in init) {
                    if (!Number.isFinite(init.status)) throw new TypeError('status should be a number');
                    this.#status = init.status;
                }
                if ('statusText' in init) {
                    if (typeof init.statusText !== 'string') throw new TypeError('statusText should be a string');
                    this.#statusText = init.statusText;
                }
                if ('headers' in init) {
                    if (typeof init.headers !== 'object') throw new TypeError('headers should be an object');
                    this.#headers = new Headers(init.headers);
                }
                if (init[secretResponseInit]) {
                    this.#url = init[secretResponseInit].url;
                    this.#redirected = init[secretResponseInit].redirected;
                    if (init[secretResponseInit].error) {
                        this.#type = 'error';
                        this.#status = 0;
                        this.#statusText = '';
                        this.#url = '';
                        this.#redirected = false;
                    }
                }
            }

            Object.defineProperties(this, {
                headers: {
                    enumerable: true,
                    get: () => this.#headers,
                },
                redirected: {
                    enumerable: true,
                    get: () => this.#redirected,
                },
                ok: {
                    enumerable: true,
                    get: () =>  this.status >= 200 && this.status < 300,
                },
                status: {
                    enumerable: true,
                    get: () => this.#status,
                },
                statusText: {
                    enumerable: true,
                    get: () => this.#statusText,
                },
                type: {
                    enumerable: true,
                    get: () => this.#type,
                },
                url: {
                    enumerable: true,
                    get: () => this.#url,
                },
                body: {
                    enumerable: true,
                    get: () => this.#body,
                },
                bodyUsed: {
                    enumerable: true,
                    get: () => streamData.get(this.#body).isBodyUsed(),
                },
                useFinalURL: {
                    // TODO: what does this do?
                    get: () => true,
                },
            });
        }

        clone() {
            // TODO: do property
            return new Response(this.#body, this);
        }

        error() {
            return new Response(blobToReadableStream(new Blob([])), {
                [secretResponseInit]: { error: true },
            });
        }

        redirect() {
            // TODO
        }

        arrayBuffer() {
            return readableStreamToBuffer(this.#body);
        }
        async blob() {
            return new Blob([await this.arrayBuffer()]);
        }
        formData() {
            // TODO
            throw new Error('FormData not implemented');
        }
        async json() {
            return JSON.parse(await this.text());
        }
        async text() {
            const td = new TextDecoder();
            return td.decode(await this.arrayBuffer());
        }
    }

    const consoleLog = console.log;
    globalThis.fetch = async function fetch(resource, init) {
        const request = new Request(resource, init);

        if (init) {
            if (init.signal) {
                // TODO: AbortController
            }
        }

        {
            let extra = '';
            if (request.headers.get('host')) {
                extra += ` (as ${request.headers.get('host')})`;
            }
            consoleLog(`[fetch] ${request.method} ${request.url}${extra}`);
        }

        const body = new Uint8Array(await readableStreamToBuffer(request.body));

        // FIXME: use a mutable buffer instead of using the JSON response (which is super slow)
        const response = Deno.core.opSync('aof_fetch', {
            url: request.url,
            method: request.method,
            headers: [...request.headers],
            redirect: request.redirect,
            referrer: request.referrer,
        }, body);

        const headers = new Headers();
        const td = new TextDecoder();
        for (const [k, v] of response.headers) {
            headers.append(k, td.decode(new Uint8Array(v)));
        }

        const bodyLen = response.body.length;
        consoleLog(`[fetch] -> ${response.status_text} (${bodyLen} byte${bodyLen === 1 ? '' : 's'})`);

        let statusText = response.status_text;
        if (statusText.startsWith(response.status + ' ')) statusText = statusText.replace(/^(\d+)\s+/, '');

        return new Response(new Uint8Array(response.body), {
            headers,
            status: response.status,
            statusText,
            [secretResponseInit]: {
                url: response.url,
                redirected: response.redirected,
            },
        });
    };

    Deno.core.ops(); // TODO: do this elsewhere?
}
