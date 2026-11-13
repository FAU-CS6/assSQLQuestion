// The existing test bodies run in Chrome. Unsupported runner options fail
// instead of silently weakening a test; there are no execution deadlines.
const tests = [], after = [];
function test(name, options, fn) {
    if (typeof options === 'function') { fn = options; options = {}; }
    for (const key of Object.keys(options || {})) {
        if (key !== 'skip') throw new Error('Unsupported browser test option: ' + key);
    }
    tests.push({name, fn, skip: options?.skip});
}
test.after = fn => after.push(fn);
export default test;

export async function run() {
    const results = [];
    try {
        for (const item of tests) {
            const start = performance.now(), diagnostics = [];
            let result;
            if (item.skip) result = {name: item.name, skipped: true};
            else {
                try {
                    await item.fn({diagnostic: value => diagnostics.push(value)});
                    result = {name: item.name, passed: true, ms: performance.now() - start, diagnostics};
                } catch (error) {
                    result = {name: item.name, passed: false, ms: performance.now() - start,
                        error: error.stack || String(error), diagnostics};
                }
            }
            results.push(result);
            await globalThis.reportQssTest(result);
        }
    } finally {
        for (const fn of after) await fn();
    }
    return results;
}
