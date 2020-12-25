type ObjectMap = { [k: string]: unknown };

function getObjectMap(obj: ObjectMap | null, key: string) {
    if (!obj) return null;
    if (obj[key] && typeof obj[key] === 'object') {
        return obj[key] as ObjectMap;
    }
    return null;
}
function ensureObjectMap(obj: ObjectMap, key: string): ObjectMap {
    if (!obj[key] || typeof obj[key] !== 'object') {
        obj[key] = {};
    }
    return obj[key] as ObjectMap;
}

export class SourceUserData {
    data: ObjectMap | null;

    constructor(data: ObjectMap | null) {
        this.data = data;
    }

    rawData() {
        return getObjectMap(this as any, 'data');
    }

    ensureRawData() {
        return ensureObjectMap(this as any, 'data');
    }

    rawReadState() {
        return getObjectMap(this.rawData(), 'read');
    }

    ensureRawReadState() {
        return ensureObjectMap(this.ensureRawData(), 'read');
    }

    itemReadState(itemPath: string) {
        return new SourceUserDataItemReadState(this, itemPath);
    }
}

class SourceUserDataItemReadState {
    data: SourceUserData;
    itemPath: string;

    constructor(data: SourceUserData, itemPath: string) {
        this.data = data;
        this.itemPath = itemPath;
    }

    rawState() {
        return getObjectMap(this.data.rawReadState(), this.itemPath);
    }

    ensureRawState() {
        return ensureObjectMap(this.data.ensureRawReadState(), this.itemPath);
    }

    get read() {
        const rawState = this.rawState();
        if (rawState) return !!rawState.read;
        return false;
    }

    set read(read) {
        this.ensureRawState().read = read;
    }
}
