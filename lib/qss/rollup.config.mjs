import {createRequire, stripTypeScriptTypes} from 'node:module';
import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import commonjs from '@rollup/plugin-commonjs';

const require = createRequire(import.meta.url), here = path.dirname(fileURLToPath(import.meta.url));
// All runtime imports are local files or pinned npm packages. Prefer their ESM
// module entry; no generic object-merging resolver dependency is needed.
const resolve = {
    name: 'qss-browser-package-resolver',
    load(id) {
        if (id.endsWith('/cost-catalog.json')) return 'export default ' + readFileSync(id, 'utf8') + ';';
        return null;
    },
    resolveId(source, importer) {
        if (source.startsWith('\0') || source.includes('?commonjs')) return null;
        if (!importer && existsSync(path.resolve(here, source))) return path.resolve(here, source);
        if (source.startsWith('.') || source.startsWith('/')) {
            const base = path.resolve(importer ? path.dirname(importer) : here, source);
            for (const suffix of ['', '.mjs', '.js', '.ts', '/index.js', '/index.ts']) {
                const candidate = base + suffix;
                if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
            }
            return null;
        }
        const resolved = require.resolve(source, {paths: [importer ? path.dirname(importer) : here, here]});
        const rootName = source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0];
        if (source !== rootName) return resolved;
        for (let dir = path.dirname(resolved); dir !== path.dirname(dir); dir = path.dirname(dir)) {
            const metadata = path.join(dir, 'package.json');
            if (!existsSync(metadata)) continue;
            const pkg = JSON.parse(readFileSync(metadata, 'utf8'));
            if (pkg.name === rootName) return pkg.module ? path.resolve(dir, pkg.module) : resolved;
        }
        return resolved;
    }
};

const typescript = {
    name: 'node-typescript-transform',
    transform(code, id) {
        if (!id.endsWith('.ts')) return null;
        return {code: stripTypeScriptTypes(code, {mode: 'transform'}), map: null};
    }
};
const plugins = () => [typescript, resolve, commonjs()];
export default [
    {input: 'src/engine.mjs', output: {file: 'qss.js', format: 'iife', name: 'QSS', sourcemap: false}, plugins: plugins()},
    {input: 'src/worker.mjs', output: {file: 'worker.qss.js', format: 'iife', sourcemap: false}, plugins: plugins()}
];
