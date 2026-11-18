/** Bind one server-issued render nonce to the native ILIAS test form. */
class TestFormToken {
    static bind(marker) {
        if (!marker || !marker.isConnected) return;
        const token = marker.getAttribute('data-qpisql-test-form-token');
        if (!/^-[1-9][0-9]*$/.test(token || '') || !Number.isSafeInteger(Number(token))) return;
        const form = marker.closest('form');
        if (!form || form.id !== 'taForm' || form.name !== 'test_output') return;

        // AJAX can reload the script and several SQL blocks can be embedded in
        // one form. Neither operation may mint a fresh submission identity.
        const key = Symbol.for('qpisql.testFormToken');
        if (form[key]) {
            form[key].sync();
            return;
        }
        const scope = form.closest('#tst_output') || form;
        const sync = () => {
            if (!form.isConnected) {
                state.observer.disconnect();
                return;
            }
            for (const field of scope.querySelectorAll('input[name="formtimestamp"]')) {
                if (field.form === form || (field.form && field.form.name === 'test_output_bottom')) {
                    // Keep the decimal string exact, including in native form
                    // reset/serialization. Never generate a token on submit.
                    field.defaultValue = state.token;
                    field.value = state.token;
                }
            }
        };
        const state = {token, sync, observer: new MutationObserver(sync)};
        form[key] = state;
        // The native bottom timestamp can be parsed after this inline script.
        // Mutation delivery precedes the native DOM-ready/autosave setup; it
        // also covers later inserted fields without intercepting submission.
        state.observer.observe(scope, {childList: true, subtree: true});
        sync();
    }
}
