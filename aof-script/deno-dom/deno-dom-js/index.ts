import { register } from './deno-dom/src/parser.ts';

interface DenoCore {
    ops();
    jsonOpSync(name: string, args: any, buffer: Uint8Array): unknown;
}
const core = (Deno as any).core as DenoCore;
core.ops();

const encoder = new TextEncoder();
function parse(html: string): string {
    return core.jsonOpSync('denoDomParseSync', {}, encoder.encode(html)) as string;
}

function parseFrag(html: string): string {
    return core.jsonOpSync('denoDomParseFragSync', {}, encoder.encode(html)) as string;
}

register(parse, parseFrag);

import * as domApi from './deno-dom/src/api.ts';
for (const k in domApi) {
    globalThis[k] = domApi[k];
}
