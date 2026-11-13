/* Native form serialization and lifecycle checks; no SQL runs in this test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
    const browser = process.env.CHROME_CDP_URL
        ? await chromium.connectOverCDP(process.env.CHROME_CDP_URL)
        : await chromium.launch({channel: 'chrome', headless: true});
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.setContent('<!doctype html><title>Test form lifecycle</title>');
        await page.addScriptTag({content: fs.readFileSync(path.resolve(__dirname, '../../js/classes/class.TestFormToken.js'), 'utf8')});
        const result = await page.evaluate(async () => {
            const tick = () => new Promise(resolve => queueMicrotask(resolve));
            const nativeForm = (token, extra = '') => `<div id="tst_output"><form id="taForm" name="test_output" action="/native-navigation" method="post"><input type="hidden" name="formtimestamp" value="123"><input name="answer" value="initial"><span hidden data-qpisql-test-form-token="${token}"></span>${extra}</form></div>`;
            document.body.innerHTML = nativeForm('-9007199254740991') + '<form id="unrelated"><input name="formtimestamp" value="456"></form>';
            let form = document.querySelector('#taForm');
            let marker = form.querySelector('span');
            TestFormToken.bind(marker);
            const first = new FormData(form).get('formtimestamp');
            const action = form.action;
            // A bottom field parsed after the plugin inline script must agree.
            form.insertAdjacentHTML('beforeend', '<input name="formtimestamp" type="hidden" value="123">');
            await tick();
            const late = new FormData(form).getAll('formtimestamp');
            const sameFormSecondBlock = document.createElement('span');
            sameFormSecondBlock.dataset.qpisqlTestFormToken = '-2';
            form.append(sameFormSecondBlock);
            TestFormToken.bind(sameFormSecondBlock);
            const repeated = new FormData(form).getAll('formtimestamp');

            // The core's autosave, navigation and deadline serialize/submit
            // this same form. The plugin does not install submit listeners.
            let submits = 0;
            form.addEventListener('submit', event => {event.preventDefault(); submits++;});
            form.requestSubmit();
            form.requestSubmit();
            const submitted = new FormData(form).getAll('formtimestamp');
            form.reset();
            const reset = new FormData(form).getAll('formtimestamp');
            const unrelated = new FormData(document.querySelector('#unrelated')).get('formtimestamp');

            // Native split-bottom forms must share the identity, while modal
            // and unrelated forms within the wrapper remain untouched.
            document.querySelector('#tst_output').insertAdjacentHTML('beforeend', '<form name="test_output_bottom"><input name="formtimestamp" value="123"></form><form id="modal"><input name="formtimestamp" value="789"></form>');
            await tick();
            const bottom = new FormData(document.querySelector('[name="test_output_bottom"]')).get('formtimestamp');
            const modal = new FormData(document.querySelector('#modal')).get('formtimestamp');

            // A genuinely replaced form receives a fresh server render nonce.
            const oldForm = form;
            document.querySelector('#tst_output').outerHTML = nativeForm('-41');
            form = document.querySelector('#taForm');
            TestFormToken.bind(form.querySelector('span'));
            TestFormToken.bind(marker); // stale detached AJAX callback
            await tick();
            const replaced = new FormData(form).get('formtimestamp');
            oldForm.insertAdjacentHTML('beforeend', '<input name="formtimestamp" value="old">');
            await tick();

            // Marker-like contents in author/solution/preview forms cannot
            // alter their native tokens; invalid integers are ignored too.
            const ignored = [];
            for (const [id, name, value] of [['author', 'author', '-1'], ['taForm', 'test_output', '0'], ['taForm', 'test_output', '-9007199254740992'], ['taForm', 'test_output', '-1e3']]) {
                const host = document.createElement('div');
                host.innerHTML = `<form id="${id}" name="${name}"><input name="formtimestamp" value="321"><span data-qpisql-test-form-token="${value}"></span></form>`;
                document.body.append(host);
                TestFormToken.bind(host.querySelector('span'));
                ignored.push(new FormData(host.querySelector('form')).get('formtimestamp'));
                host.remove();
            }
            return {first, late, repeated, submitted, reset, submits, actionUnchanged: action === oldForm.action, unrelated, bottom, modal, replaced, ignored};
        });
        const first = '-9007199254740991';
        assert.equal(result.first, first);
        for (const key of ['late', 'repeated', 'submitted', 'reset']) assert.deepEqual(result[key], [first, first], key);
        assert.equal(result.submits, 2);
        assert.equal(result.actionUnchanged, true);
        assert.equal(result.unrelated, '456');
        assert.equal(result.modal, '789');
        assert.equal(result.bottom, first);
        assert.equal(result.replaced, '-41');
        assert.deepEqual(result.ignored, ['321', '321', '321', '321']);
        assert.deepEqual(errors, []);
        console.log('PASS: fixed native form identity across serialization, submit, reset, late fields, split forms, repeated blocks and AJAX replacement; unrelated forms unchanged');
    } finally {
        await context.close();
        await browser.close();
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
