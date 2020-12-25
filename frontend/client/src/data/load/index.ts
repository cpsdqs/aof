import { Load, FnA } from '../paths';
import connection from './connection';
import login from './login';
import domains from './domains';
import sources from './sources';

function getNodeIdParts(node: Load) {
    const nodeId = node.toString();
    if (!nodeId.startsWith('aof://')) throw new Error('Non-AOF node ' + nodeId);
    const parts = nodeId.substr('aof://'.length).split('/');
    const typeId = parts.shift() || '';
    const handlerId = parts.shift() || '';

    return {
        typeId,
        handlerId,
        path: parts,
    };
}

export function load<T extends Load>(node: T, data?: FnA<T>) {
    const { typeId, handlerId, path } = getNodeIdParts(node);

    const type = types[typeId];
    if (!type) throw new Error(`No handler for ${typeId}`);
    const handler = type[handlerId];
    if (!handler) throw new Error(`No handler for ${typeId}/${handlerId}`)

    return handler(data, ...path);
}

export function canLoad(node: Load) {
    const { typeId, handlerId } = getNodeIdParts(node);

    const type = types[typeId];
    if (!type) return false;
    const handler = type[handlerId];
    return !!handler;
}

type Types = {
    [k: string]: {
        // [k: string]: (...path: string[], data: object) => any,
        [k: string]: (...args: any[]) => any,
    } | undefined,
};

const types: Types = {
    connection,
    login,
    domains,
    sources,
};
