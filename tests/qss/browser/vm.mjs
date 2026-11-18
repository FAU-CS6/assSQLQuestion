// Existing bundle tests supply a small explicit global object. Evaluate their
// unmodified shipped bundle inside that object, still entirely in Chrome.
export default {
    createContext(context) {
        context.setTimeout ??= globalThis.setTimeout.bind(globalThis);
        context.clearTimeout ??= globalThis.clearTimeout.bind(globalThis);
        return context;
    },
    runInContext(code, context) {
        return new Function('context', 'with (context) {' + code
            + '; if (typeof QSS !== "undefined") context.QSS = QSS;}')(context);
    }
};
