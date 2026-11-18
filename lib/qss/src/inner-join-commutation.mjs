import {clean, empty, locations, ordinaryCatalog, sourceScope, flatSelect} from './sqlite-join-scope.mjs';
import {pureExpression} from './sql-equivalences.mjs';

export const INNER_JOIN_COMMUTATION_STEP = Object.freeze({id: 'commuteInnerJoinSources',
    label: 'Exchange two ordinary inner-join sources while retaining their explicit projection and predicate', defaultCost: 0});

export function registerInnerJoinCommutation(register, schema, options = {}) {
    const catalog = options.preparedOrdinaryCatalog ?? ordinaryCatalog(schema, options.schemaSql), step = INNER_JOIN_COMMUTATION_STEP;
    register(step.id, step.label, step.defaultCost, function* (root) {
        if (options.ambiguousSchemaNamespaces || options.outputColumnNamesObserved || options.freeLabels?.length) return;
        const select = flatSelect(root), scope = sourceScope(select, catalog, {min: 2, max: 2});
        if (!scope || !clean(select.attrs, ['distinct']) || !clean(select.slots, ['columns', 'from', 'where'])) return;
        const [a, b] = scope.sources.map(entry => entry.source), on = b.slots.on;
        if (!empty(a.attrs.join) || !empty(a.slots.on) || !['JOIN', 'INNER JOIN'].includes(b.attrs.join)
            || !on || !pureExpression(on) || select.slots.where && !pureExpression(select.slots.where)) return;
        // Bare physical projection columns preserve output names/order. No
        // wildcard, aggregate, window, volatile call, output alias lookup or
        // correlated reference may depend on source visitation order.
        const columns = select.slots.columns;
        if (!Array.isArray(columns) || !columns.length || columns.some(item => item?.kind !== 'SelectItem'
            || !clean(item.attrs, ['as']) || !clean(item.slots, ['expr']) || !scope.owner(item.slots.expr))) return;
        if ([...locations(select)].some(({node}) => node.kind === 'ColumnReference' && !scope.owner(node))) return;
        const first = {...b, attrs: {...b.attrs, join: null}, slots: {...b.slots, on: null}};
        const second = {...a, attrs: {...a.attrs, join: b.attrs.join}, slots: {...a.slots, on}};
        // The ON expression is retained byte-for-byte as an AST object. In
        // particular, operand order (SQLite affinity/collation precedence)
        // is never commuted merely because the source order changes.
        yield {path: ['slots', 'statements', 0], after: {...select, slots: {...select.slots, from: [first, second]}}};
    }, {maxNewSymbols: 0, preservesSymbolSet: true});
}
