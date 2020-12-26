import fs from 'fs';
import path from 'path';
import url from 'url';
import cson from 'cson';
import Svgo from 'svgo';
import { parse as svgParse } from 'svgson';
import { dataToEsm } from '@rollup/pluginutils';
import { babel } from '@rollup/plugin-babel';
import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import lessModules from 'rollup-plugin-less-modules';
import rust from '@wasm-tool/rollup-plugin-rust';
import offMainThread from '@surma/rollup-plugin-off-main-thread';
import { terser } from 'rollup-plugin-terser';
import html from '@open-wc/rollup-plugin-html';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const prod = process.env.NODE_ENV === 'production';

export default {
    input: 'src/index.tsx',
    preserveSymlinks: true,
    preserveEntrySignatures: false,
    plugins: [
        lessModules({
            output: '../../static/client/index.css',
            exclude: [],
        }),
        csonPlugin(),
        typescript({}),
        iconsPlugin(),
        babel({
            babelHelpers: 'bundled',
            presets: [
                ['@babel/preset-react', { pragma: 'h' }],
            ],
            plugins: [
                '@babel/plugin-proposal-class-properties',
                '@babel/plugin-proposal-export-default-from',
            ],
            include: ['src/**', 'node_modules/uikit/**'],
        }),
        offMainThread(),
        nodeResolve(),
        commonjs(),
        prod && terser(),
        html({
            template: () => new Promise((resolve, reject) => {
                fs.readFile(path.join(__dirname, 'index.html'), 'utf-8', (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            }),
        }),
        rust({
            debug: false, // force release mode because otherwise crypto is *sloooow*
            serverPath: '.',
        }),
    ].filter(x => x),
    moduleContext: id => {
        if (id.includes('node_modules/@msgpack/msgpack')) {
            // this library expects `this` to be window despite being ESM
            return 'window';
        }
        return 'undefined';
    },
    output: {
        dir: '../../static/client/',
        format: 'amd',
        chunkFileNames: '[name]-[hash].js',
    },
};

function csonPlugin() {
    return {
        name: 'cson',
        transform(data, id) {
            if (id.slice(-5) !== '.cson') return null;
            try {
                const parsed = cson.parse(data);
                return {
                    code: dataToEsm(parsed, {
                        indent: '\t',
                    }),
                    map: { mappings: '' },
                };
            } catch (err) {
                this.warn({
                    message: 'Failed to parse CSON',
                    id,
                    position: 0,
                });
                return null;
            }
        }
    };
}

function iconsPlugin() {
    const svgo = new Svgo({
        plugins: [{
            removeViewBox: false,
        }],
    });

    return {
        name: 'aof-icons',
        resolveId(id) {
            if (id.startsWith('icon!')) {
                return id;
            }
            return null;
        },
        load: async (id) => {
            if (id.startsWith('icon!')) {
                const name = id.substr(5);
                const filePath = path.join(__dirname, 'icons', name + '.svg');
                const className = name.replace(/[^\w]/g, '');

                const fileContents = await new Promise((resolve, reject) => {
                    fs.readFile(filePath, 'utf-8', (err, data) => {
                        if (err) reject(err);
                        else resolve(data);
                    })
                });
                const result = await svgo.optimize(fileContents);
                const parsed = await svgParse(result.data);

                function transform(node) {
                    if (node.type === 'text') return JSON.stringify(node.value);
                    let out = 'h(';
                    out += JSON.stringify(node.name);
                    out += ', {';
                    for (const k in node.attributes) {
                        if (node.name === 'svg' && ['xmlns', 'xmlns:xlink', 'version'].includes(k)) continue;

                        let v = node.attributes[k];
                        if (['fill', 'stroke'].includes(k) && ['black', '#000000', '#000'].includes(v)) {
                            v = 'currentColor';
                        }
                        out += JSON.stringify(k) + ': ' + JSON.stringify(v) + ',';
                    }
                    if (node.name === 'svg') out += '...props, "class": (props.class || "") + " svg-icon"';
                    out += '}, ';

                    if (node.name === 'svg') {
                        out += `props.title ? h('title', {}, props.title) : null, `;
                    }

                    for (const child of node.children) {
                        out += transform(child) + ', ';
                    }
                    out += ')';
                    return out;
                }
                const transformed = transform(parsed);

                const code = `import { h } from 'preact';

export default function Icon_${className}(props) {
    return (
        ${transformed}
    );
}`
                return { code };
            }
            return null;
        }
    }
}
