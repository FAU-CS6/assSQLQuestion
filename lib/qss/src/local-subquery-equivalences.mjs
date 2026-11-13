import {fold, clean, empty, plainColumn, locations, ordinaryCatalog, sourceScope} from './sqlite-join-scope.mjs';

export const LOCAL_SUBQUERY_STEPS = Object.freeze([
    {id: 'qualifyLocalSubqueryColumn', label: 'Use or omit a physical local column qualifier in an uncorrelated single-source subquery', defaultCost: 0},
    {id: 'toggleLocalSubqueryTableAlias', label: 'Use or omit a table alias identical to its binding in an uncorrelated single-source subquery', defaultCost: 0}
]);

export function registerLocalSubqueryEquivalences(register, schema, options = {}) {
    const catalog = options.preparedOrdinaryCatalog ?? ordinaryCatalog(schema, options.schemaSql), cache = new WeakMap();
    const localScopes = root => {
        if (cache.has(root)) return cache.get(root);
        const scopes = [];
        // A surrounding WITH can shadow a catalog table even when this SELECT
        // has no local WITH clause. This rule never resolves inherited CTEs.
        if ([...locations(root)].some(({node}) => node.kind === 'CommonTableExpression' || !empty(node.slots.with))) {
            cache.set(root, scopes); return scopes;
        }
        for (const {node: wrapper, path} of locations(root)) {
            if (wrapper.kind !== 'Subquery' || !clean(wrapper.attrs, []) || !clean(wrapper.slots, ['ast'])) continue;
            const select = wrapper.slots.ast, scope = sourceScope(select, catalog, {max: 1});
            if (!scope || !empty(scope.sources[0].source.attrs.join) || !empty(scope.sources[0].source.slots.on)
                || !clean(select.slots, ['columns', 'from', 'where']) || !clean(select.attrs, ['distinct'])) continue;
            const entries = [...locations(select)];
            if (entries.some(({node}) => node !== select && ['Select', 'CompoundSelect', 'Subquery', 'CommonTableExpression',
                'Values', 'Explain', 'TableGroup', 'Asterisk'].includes(node.kind))) continue;
            // Unknown columns may be correlated outer references. No rewrite
            // is offered until every physical reference is proved local.
            if (entries.some(({node}) => node.kind === 'ColumnReference' && scope.owner(node) !== scope.sources[0])) continue;
            const columns = select.slots.columns;
            if (!Array.isArray(columns) || !columns.length || columns.some(item => item?.kind !== 'SelectItem'
                || !clean(item.attrs, ['as']) || !clean(item.slots, ['expr']) || !plainColumn(item.slots.expr))) continue;
            scopes.push({...scope, path: [...path, 'slots', 'ast'], entries});
        }
        cache.set(root, scopes); return scopes;
    };
    const blocked = () => options.outputColumnNamesObserved || options.ambiguousSchemaNamespaces || options.freeLabels?.length;
    const annotations = {maxNewSymbols: 0, preservesSymbolSet: true};
    const [qualifier, alias] = LOCAL_SUBQUERY_STEPS;
    register(qualifier.id, qualifier.label, qualifier.defaultCost, function* (root) {
        if (blocked()) return;
        for (const scope of localScopes(root)) for (const {node, path} of scope.entries) {
            if (!plainColumn(node)) continue;
            yield {path: [...scope.path, ...path], after: {...node,
                attrs: {...node.attrs, table: node.attrs.table == null ? scope.sources[0].binding : null}}};
        }
    }, annotations);
    register(alias.id, alias.label, alias.defaultCost, function* (root) {
        if (blocked()) return;
        for (const scope of localScopes(root)) {
            const source = scope.sources[0].source;
            if (source.attrs.as != null && fold(source.attrs.as) !== fold(source.attrs.table)) continue;
            yield {path: [...scope.path, 'slots', 'from', 0], after: {...source,
                attrs: {...source.attrs, as: source.attrs.as == null ? source.attrs.table : null}}};
        }
    }, annotations);
}
