import path from 'path';
import url from 'url';
import nodeResolve from '@rollup/plugin-node-resolve';
import { babel } from '@rollup/plugin-babel';
import alias from '@rollup/plugin-alias';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export default {
    input: 'index.ts',
    preserveSymlinks: true,
    plugins: [
        babel({
            presets: ['@babel/preset-typescript'],
            babelHelpers: 'bundled',
            extensions: ['.js', '.ts'],
            plugins: [
                '@babel/plugin-proposal-class-properties',
            ],
        }),
        alias({
            entries: [
                { find: /^(.*)\/constructor-lock.ts$/, replacement: path.join(__dirname, 'constructor-lock.patch.ts') },
            ],
        }),
        nodeResolve(),
    ],
    output: {
        file: 'deno_dom.js',
        format: 'iife',
    },
};
