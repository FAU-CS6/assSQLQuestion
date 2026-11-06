import {nodeResolve} from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: 'editor.mjs',
  output: {
    file: 'codemirror_sqlquestion.bundle.js',
    format: 'iife',
    name: 'codemirror_sqlquestion'
  },
  plugins: [nodeResolve(), terser({maxWorkers: 1})]
};
