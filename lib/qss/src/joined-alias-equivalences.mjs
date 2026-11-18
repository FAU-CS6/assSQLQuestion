import {fold, empty, plainColumn, ordinaryCatalog, sourceScope, flatSelect} from './sqlite-join-scope.mjs';

export const JOINED_ALIAS_STEPS = Object.freeze([
    {id: 'toggleJoinedProjectionAlias', label: 'Use or omit a redundant bare-column output alias in a multi-table query', defaultCost: 0},
    {id: 'toggleJoinedIdenticalTableAlias', label: 'Use or omit a base-table alias identical to its binding in a multi-table query', defaultCost: 0}
]);

export function registerJoinedAliasEquivalences(register, schema, options = {}) {
    const catalog = options.preparedOrdinaryCatalog ?? ordinaryCatalog(schema, options.schemaSql), cache = new WeakMap();
    const scopeFor = root => {
        if (!cache.has(root)) {
            const select = flatSelect(root);
            cache.set(root, select ? sourceScope(select, catalog, {min: 2, allowLeft: true}) : null);
        }
        return cache.get(root);
    };
    const blocked = () => options.ambiguousSchemaNamespaces || options.outputColumnNamesObserved || options.freeLabels?.length;
    const [projection, table] = JOINED_ALIAS_STEPS, annotations = {maxNewSymbols: 0, preservesSymbolSet: true};
    register(projection.id, projection.label, projection.defaultCost, function* (root) {
        if (blocked()) return;
        const scope = scopeFor(root); if (!scope) return;
        const select = scope.select;
        // Output aliases participate in SQLite ORDER/GROUP/HAVING lookup.
        // Keep these contexts unavailable rather than silently retargeting them.
        if (!empty(select.slots.orderby) || !empty(select.slots.groupby) || !empty(select.slots.having)) return;
        const columns = select.slots.columns || [];
        for (let i = 0; i < columns.length; i++) {
            const item = columns[i], column = item?.slots?.expr, owner = scope.owner(column);
            if (item?.kind !== 'SelectItem' || !plainColumn(column) || !owner) continue;
            const output = owner.table.columns.get(fold(column.attrs.column)).name;
            if (item.attrs.as != null && item.attrs.as !== output) continue;
            // Avoid duplicate result names, including implicit bare-column
            // headers. Their downstream name resolution can prefer aliases.
            if (columns.some((other, at) => at !== i && (typeof other?.attrs?.as === 'string' && fold(other.attrs.as) === fold(output)
                || plainColumn(other?.slots?.expr) && fold(other.slots.expr.attrs.column) === fold(output)))) continue;
            yield {path: ['slots', 'statements', 0, 'slots', 'columns', i],
                after: {...item, attrs: {...item.attrs, as: item.attrs.as == null ? output : null}}};
        }
    }, annotations);
    register(table.id, table.label, table.defaultCost, function* (root) {
        if (blocked()) return;
        const scope = scopeFor(root); if (!scope) return;
        for (let i = 0; i < scope.sources.length; i++) {
            const {source} = scope.sources[i], name = source.attrs.table;
            if (source.attrs.as != null && fold(source.attrs.as) !== fold(name)) continue;
            if (scope.sources.some((entry, at) => at !== i && fold(entry.binding) === fold(name))) continue;
            yield {path: ['slots', 'statements', 0, 'slots', 'from', i],
                after: {...source, attrs: {...source.attrs, as: source.attrs.as == null ? name : null}}};
        }
    }, annotations);
}
