import { decode, encode } from '@msgpack/msgpack';
import { cache } from './cache';
import { CONNECTION, CONNECTION_STATE, ConnState, IConnection } from './paths';
import { handleEvent } from './events';
import get from '../locale';

const MAX_MSG_SIZE = 16384;
const MAX_ALLOC_SIZE = 1048576;

function u32Encode(out: Uint8Array, offset: number, number: number) {
    for (let i = 3; i >= 0; i--) {
        out[offset + i] = number & 0xff;
        number = number >> 8;
    }
}
function u32Decode(buf: Uint8Array, offset: number): number {
    if (buf.byteLength < offset + 4) throw new Error(get('data.socket.unexp_eof'));
    let out = 0;
    for (let i = 0; i < 4; i++) {
        out = (out << 8) + buf[offset + i];
    }
    return out;
}
function bufcpy(out: Uint8Array, offset: number, buf: Uint8Array, bufOffset?: number) {
    if (bufOffset) {
        out.set(buf.subarray(bufOffset), offset);
    } else {
        out.set(buf, offset);
    }
}

class Connection implements IConnection {
    constructor() {
        cache.insert(CONNECTION, this);
        this.open();
    }

    /// A promise that will be resolved when the connection opens.
    /// Guaranteed to be non-null if isOpening is true
    opening: Promise<void> | null = null;
    isOpening = false;
    isOpen = false;

    socket: WebSocket | null = null;

    open() {
        this.isOpening = true;
        cache.insert(CONNECTION_STATE, ConnState.Opening);
        this.opening = (async () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            if (protocol === 'ws:') console.warn('Using insecure socket!');

            const socketURL = new URL(window.location.href);
            socketURL.protocol = protocol;
            socketURL.pathname += '../api/session';
            socketURL.search = '';
            socketURL.hash = '';

            this.socket = new WebSocket(socketURL.toString());
            this.socket.binaryType = "arraybuffer";
            await new Promise((resolve, reject) => {
                if (!this.socket) return;
                this.socket.addEventListener('error', reject);
                this.socket.onopen = () => {
                    if (!this.socket) return;
                    this.socket.removeEventListener('error', reject);
                    resolve(null);
                };
            });
            this.socket.onmessage = this.onSocketMessage;
            this.socket.onclose = this.onSocketClose;
            this.socket.onerror = this.onSocketError;
            this.isOpen = true;

            cache.insert(CONNECTION_STATE, ConnState.Open);
        })().then(() => {
            return null;
        }, err => {
            // failed to open
            cache.insert(CONNECTION, null);
            cache.insert(CONNECTION_STATE, ConnState.Closed);

            if (err) {
                if (err.message) return new Error(get('data.socket.open_failed_reason', err.message));
                else return new Error(get('data.socket.open_failed'));
            }
        }).then(err => {
            this.isOpening = false;
            // rethrow error if there was one
            if (err) throw err;
        });
    }

    onSocketMessage = (e: MessageEvent) => {
        this.handleMessage(e.data);
    };
    onSocketClose = (e: CloseEvent) => {
        this.abortAllRequests();
        this.isOpen = false;
        cache.insert(CONNECTION, null);
        cache.insert(CONNECTION_STATE, ConnState.Closed);
    };
    onSocketError = (e: Event) => {
        console.error('Socket error', e);
    };

    close(): Promise<void> {
        return new Promise(resolve => {
            if (this.isOpening || this.isOpen) {
                if (!this.socket) throw new Error('Error state');
                cache.insert(CONNECTION_STATE, ConnState.Closing);
                this.isOpen = false;
                this.socket.addEventListener('close', () => {
                    resolve();
                });
                this.socket.close();
            }
        });
    }

    pendingRequests = new Map();

    abortAllRequests(message?: string) {
        const error = new Error(message || get('data.socket.abrupt_close'));
        for (const v of this.pendingRequests.values()) {
            v.reject(error);
        }
        this.pendingRequests.clear();
    }

    requestIdCounter = 0;
    getRequestId() {
        // JS does bitwise in 32 bits so this works out
        this.requestIdCounter = (this.requestIdCounter + 1) | 0;

        return this.requestIdCounter;
    }

    textEncoder = new TextEncoder();
    textDecoder = new TextDecoder();

    encodeRequest(id: number, name: string, data: any) {
        let encodedData;
        if (data) encodedData = encode(data);
        else encodedData = new Uint8Array(0);

        const nameBuf = this.textEncoder.encode(name);
        const headerLen = 1 + 4 + 1;
        const msg = new Uint8Array(headerLen + nameBuf.byteLength + encodedData.byteLength);

        msg[0] = 0xc0;
        u32Encode(msg, 1, id);
        msg[5] = nameBuf.byteLength;
        bufcpy(msg, 6, nameBuf);
        bufcpy(msg, 6 + nameBuf.byteLength, encodedData);

        return msg;
    }

    req(name: string, data: any, onPartial?: (d: Uint8Array) => void) {
        return new Promise((resolve, reject) => {
            if (!this.isOpen) throw new Error(get('data.socket.req_not_open'));
            if (!this.socket) throw new Error('Error state');

            const requestId = this.getRequestId();
            const requestBuf = this.encodeRequest(requestId, name, data);

            this.pendingRequests.set(requestId, {
                buffer: null,
                cursor: 0,
                resolve,
                partial: (data: Uint8Array) => {
                    if (onPartial) {
                        try {
                            onPartial(data);
                        } catch (err) {
                            console.error('Error in partial response handler', err);
                        }
                    }
                },
                reject,
            });

            this.socket.send(requestBuf);
        });
    }

    handleMessage(_msg: ArrayBuffer | string) {
        if (!(_msg instanceof ArrayBuffer)) throw new Error(get('data.socket.unexp_nb'));
        const msg = new Uint8Array(_msg);
        const type = msg[0];
        if (type === 0xc8) {
            // response
            const requestId = u32Decode(msg, 1);
            if (!this.pendingRequests.has(requestId)) {
                console.warn('Ignoring response message for unknown request id ' + requestId);
                return;
            }
            const pendingRequest = this.pendingRequests.get(requestId);

            const responseLen = u32Decode(msg, 5);
            if (responseLen > MAX_ALLOC_SIZE) {
                throw new Error(get('data.socket.resp_size', responseLen, MAX_ALLOC_SIZE));
            }
            pendingRequest.buffer = new Uint8Array(responseLen);
            pendingRequest.cursor = 0;

            const chunkLen = msg.byteLength - 9;
            bufcpy(pendingRequest.buffer, 0, msg, 9);
            pendingRequest.cursor += chunkLen;

            if (pendingRequest.cursor < responseLen) {
                // still awaiting more
                pendingRequest.partial(pendingRequest.buffer.subarray(0, pendingRequest.cursor));
            } else {
                pendingRequest.resolve(pendingRequest.buffer);
            }
        } else if (type === 0xc9) {
            // response continuation
            const requestId = u32Decode(msg, 1);
            if (!this.pendingRequests.has(requestId)) {
                console.warn('Ignoring response continuation for unknown request id ' + requestId);
                return;
            }
            const pendingRequest = this.pendingRequests.get(requestId);

            const chunkLen = msg.byteLength - 5;
            bufcpy(pendingRequest.buffer, pendingRequest.cursor, msg, 5);
            pendingRequest.cursor += chunkLen;

            if (pendingRequest.cursor < pendingRequest.buffer.byteLength) {
                // still awaiting more...
                pendingRequest.partial(pendingRequest.buffer.subarray(0, pendingRequest.cursor));
            } else {
                pendingRequest.resolve(pendingRequest.buffer);
            }
        } else if (type === 0xcc) {
            // response failure
            const requestId = u32Decode(msg, 1);
            if (!this.pendingRequests.has(requestId)) {
                console.warn('Ignoring response failure for unknown request id ' + requestId);
                return;
            }
            const pendingRequest = this.pendingRequests.get(requestId);
            pendingRequest.reject(new Error(get('data.socket.resp_failure')));
        } else if (type === 0xb8) {
            // event
            const nameLen = msg[1];
            const nameBuf = msg.subarray(2, 2 + nameLen);
            const name = this.textDecoder.decode(nameBuf);
            const dataBuf = msg.subarray(2 + nameLen);
            const data = decode(dataBuf);
            this.handleEvent(name, data);
        } else {
            throw new Error(get('data.socket.unexp_msg_type', (type || 'NONE').toString(16)));
        }
    }

    handleEvent(name: string, data: unknown) {
        if (name === 'protocol_error') {
            console.error('Protocol error: ', data);
            this.abortAllRequests(get('data.socket.protocol_error'));
        } else {
            handleEvent(name, data);
        }
    }
}

export async function getConn(): Promise<IConnection> {
    const conn = cache.get(CONNECTION);
    if (!conn) {
        // there is no connection; create one and try again
        new Connection();
        return getConn();
    }

    if (!conn.isOpen) {
        // there is a connection but it's not open

        if (conn.isOpening) {
            // the connection is opening; wait for it to open
            await conn.opening;
        } else {
            // faulty connection? no idea
            throw new Error(get('data.socket.exists_not_open'));
        }

        // then try again
        return getConn();
    }

    return conn;
}

export function close() {
    const conn = cache.get(CONNECTION);
    if (!conn) throw new Error(get('data.socket.close_null'));
    return conn.close();
}

export async function req<T = unknown>(name: string, data: any, onPartial?: (d: Uint8Array) => void) {
    const conn = await getConn();
    const result = await conn.req(name, data, onPartial);
    return decode(result) as T;
}
