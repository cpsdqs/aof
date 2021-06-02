// simple decoder for partial msgpack data

const makeView = (ab: ArrayBuffer, off: number): DataView | null => {
    if (off < ab.byteLength) return new DataView(ab, off);
    return null;
};

function decodeValue(view: DataView | null): [number, unknown] {
    if (!view) return [0, null];
    const type = view.getUint8(0);
    if (type === 0xc0) return [1, null];
    else if (type === 0xc2) return [1, false];
    else if (type === 0xc3) return [1, true];
    else if ((type & 0b1000_0000) === 0) return [1, type];
    else if ((type & 0b1110_0000) === 0b1110_0000) return [1, -(type & 0b1_1111)];
    else if (type === 0xcc) return [2, view.getUint8(1)];
    else if (type === 0xcd) return [3, view.getUint16(1)];
    else if (type === 0xce) return [5, view.getUint32(1)];
    else if (type === 0xcf) return [9, +view.getBigUint64(1).toString(10)];
    else if (type === 0xd0) return [2, view.getInt8(1)];
    else if (type === 0xd1) return [3, view.getInt16(1)];
    else if (type === 0xd2) return [5, view.getInt32(1)];
    else if (type === 0xd3) return [9, +view.getBigInt64(1).toString(10)];
    else if (type === 0xca) return [5, view.getFloat32(1)];
    else if (type === 0xcb) return [9, view.getFloat64(1)];
    else if ((type & 0b1010_0000) === 0b1010_0000) {
        const len = type & 0b1_1111;
        const subarray = new Uint8Array(view.buffer).subarray(view.byteOffset + 1, view.byteOffset + 1 + len);
        return [len + 1, new TextDecoder().decode(subarray)];
    } else if (type === 0xd9) {
        const len = view.getUint8(1);
        const subarray = new Uint8Array(view.buffer).subarray(view.byteOffset + 2, view.byteOffset + 2 + len);
        return [len + 2, new TextDecoder().decode(subarray)];
    } else if (type === 0xda) {
        const len = view.getUint16(1);
        const subarray = new Uint8Array(view.buffer).subarray(view.byteOffset + 3, view.byteOffset + 3 + len);
        return [len + 3, new TextDecoder().decode(subarray)];
    } else if (type === 0xdb) {
        const len = view.getUint32(1);
        const subarray = new Uint8Array(view.buffer).subarray(view.byteOffset + 5, view.byteOffset + 5 + len);
        return [len + 5, new TextDecoder().decode(subarray)];
    } else if (type === 0xc4) return [view.getUint8(1), null];
    else if (type === 0xc5) return [view.getUint16(1), null];
    else if (type === 0xc6) return [view.getUint32(1), null];
    else if ((type & 0b1001_0000) === 0b1001_0000 || type === 0xdc || type === 0xdd) {
        let len, off;
        if (type === 0xdc) {
            len = view.getUint16(1);
            off = 3;
        } else if (type === 0xdd) {
            len = view.getUint32(1);
            off = 5;
        } else {
            len = type & 0b1111;
            off = 1;
        }
        const array = [];
        for (let i = 0; i < len; i++) {
            const [len, value] = decodeValue(makeView(view.buffer, view.byteOffset + off));
            off += len;
            array.push(value);
        }
        return [off, array];
    } else if ((type & 0b1000_0000) === 0b1000_0000 || type === 0xde || type === 0xdf) {
        let count, off;
        if (type === 0xde) {
            count = view.getUint16(1);
            off = 3;
        } else if (type === 0xdf) {
            count = view.getUint32(1);
            off = 5;
        } else {
            count = type & 0b1111;
            off = 1;
        }
        const data: { [k: string]: unknown } = {};
        for (let i = 0; i < count; i++) {
            const [keyLen, key] = decodeValue(makeView(view.buffer, view.byteOffset + off));
            off += keyLen;
            const [valueLen, value] = decodeValue(makeView(view.buffer, view.byteOffset + off));
            off += valueLen;
            if (typeof key === 'string') {
                data[key] = value;
            }
        }
        return [off, data];
    } else {
        return [1, null];
    }
}

export function partialDecode(buf: Uint8Array): unknown {
    const bufView = new DataView(buf.buffer);
    return decodeValue(bufView)[1];
}
