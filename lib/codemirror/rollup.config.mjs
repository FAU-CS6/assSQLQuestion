import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'import-meta-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: 'editor.mjs',
  output: {
    file: 'codemirror_sqlquestion.bundle.js',
    format: 'iife',
    name: 'codemirror_sqlquestion'
  },
  plugins: [{
    name: 'resolve-editor-packages',
    resolveId(specifier, importer) {
      if (!importer || specifier.startsWith('.') || specifier.startsWith('/')) return null;
      return fileURLToPath(resolve(specifier, pathToFileURL(importer).href));
    }
  }, terser({maxWorkers: 1})]
};
