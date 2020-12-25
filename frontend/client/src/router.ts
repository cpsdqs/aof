import get from './locale';

export type Route = {
    raw: string,
    id: string,
    match: string[],
    title: string,
    key: string,
    value: object,
}[];

export interface PageProps {
    route: { [k: string]: any | undefined },
}

type Paths = {
    match: RegExp,
    title: (m: string[]) => string,
    id: string,
    key: string,
    value: (m: string[]) => object,
    paths?: Paths,
}[];

export const routes: Paths = [
    {
        match: /^domains/,
        title: () => get('header.routes.domains'),
        id: 'domains',
        key: 'domains',
        value: () => ({}),
        paths: [
            {
                match: /^\/([^/]+)/,
                title: match => get('header.routes.domain', match[1].toUpperCase()),
                id: 'domain',
                key: 'domain',
                value: match => ({ id: match[1] }),
            },
        ],
    },
    {
        match: /^settings/,
        title: () => get('header.routes.settings'),
        id: 'settings',
        key: 'settings',
        value: () => ({}),
        paths: [
            {
                match: /^\/debug/,
                title: () => '[DEBUG]',
                id: 'debug',
                key: '__debug',
                value: () => ({}),
            },
        ],
    },
    {
        match: /^sources/,
        title: () => get('header.routes.sources'),
        id: 'sources',
        key: 'sources',
        value: () => ({}),
        paths: [
            {
                match: /^\/([^/]+)(\/[^:]+)/,
                title: match => get('header.routes.source', match[1].toUpperCase()),
                id: 'source',
                key: 'source',
                value: match => ({ domain: match[1], path: match[2] }),
                paths: [
                    {
                        match: /^:item(\/[^:]+)/,
                        title: () => get('header.routes.source_item'),
                        id: 'source_item',
                        key: 'item',
                        value: match => ({ path: match[1] }),
                    },
                ],
            },
        ],
    },
];

function parseOnePart(paths: Paths, part: string) {
    for (const p of paths) {
        const m = part.match(p.match);
        if (m) {
            return {
                raw: m[0],
                rest: part.substr(m[0].length),
                restPaths: p.paths || [],
                match: m,
                id: p.id,
                title: p.title(m),
                key: p.key,
                value: p.value(m),
            };
        }
    }
    return null;
}

export function parseRoute(path: string): Route {
    let rest = path;
    const parts = [];
    let paths = routes;
    while (rest) {
        const res = parseOnePart(paths, rest);
        if (!res) {
            return [{
                raw: rest,
                id: 'not-found',
                match: [],
                title: 'Error',
                key: '__error',
                value: {},
            }];
        }
        rest = res.rest;
        paths = res.restPaths;
        parts.push(res);
    }
    return parts;
}
