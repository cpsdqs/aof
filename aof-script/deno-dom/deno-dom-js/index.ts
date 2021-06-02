import { register } from './deno-dom/src/parser.ts';

interface DenoCore {
    opSync(op: string, data1?: unknown, data2?: unknown): unknown;
}
const core = (globalThis as any).Deno.core as DenoCore;

const encoder = new TextEncoder();
function parse(html: string): string {
    return core.opSync('deno_dom_parse_sync', html) as string;
}

function parseFrag(html: string): string {
    return core.opSync('deno_dom_parse_frag_sync', html) as string;
}

register(parse, parseFrag);

import * as domApi from './deno-dom/src/api.ts';
for (const k in domApi) {
    globalThis[k] = domApi[k];
}
