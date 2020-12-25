import fs from 'fs';
import { babel } from '@rollup/plugin-babel';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import lessModules from 'rollup-plugin-less-modules';
import rust from '@wasm-tool/rollup-plugin-rust';
import offMainThread from '@surma/rollup-plugin-off-main-thread';
import { terser } from 'rollup-plugin-terser';

const prod = process.env.NODE_ENV === 'production';

export default {
    input: 'src/index.js',
    preserveSymlinks: true,
    plugins: [
        lessModules({
            output: '../../static/static/dist/index.css',
            exclude: [],
        }),
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
        addFilePathPrefix('static/dist'),
        offMainThread({
            loader: fs.readFileSync('./loader.ejs', 'utf8'),
        }),
        nodeResolve(),
        commonjs(),
        prod && terser(),
        rust({
            debug: false, // force release mode because otherwise crypto is *sloooow*
            serverPath: 'static/',
        }),
    ].filter(x => x),
    output: {
        dir: '../../static/static/dist/',
        format: 'amd',
    },
};

function addFilePathPrefix (prefix) {
    return {
        name: 'add-file-path-prefix',
        resolveFileUrl({ fileName }) {
            if (fileName.endsWith('.wasm')) {
                // this plugin *DOES* resolve stuff correctly
                return JSON.stringify(fileName);
            }
            return JSON.stringify(`${prefix}/${fileName}`);
        },
    }
}
