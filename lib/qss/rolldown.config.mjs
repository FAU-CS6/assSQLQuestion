// The release and browser tests use the same TypeScript, JSON and CommonJS resolution.
export default [
    {input: 'src/engine.mjs', output: {file: 'qss.js', format: 'iife', name: 'QSS'}},
    {input: 'src/worker.mjs', output: {file: 'worker.qss.js', format: 'iife'}}
].map(config => ({...config, resolve: {symlinks: false}}));
