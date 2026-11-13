const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;

/** A deliberately partial output-label view for a binary search bound.
 * Unknown expressions/scopes return null. The concrete graph is unchanged.
 * Explicit AS retains its spelling; physical columns use SQLite's catalog
 * spelling, just like the guarded redundant-alias equivalences.
 */
export function createProjectionLabels(schema) {
    const tables = new Map(), cache = new WeakMap();
    for (const table of schema?.tables || []) {
        const key = fold(table.name);
        if (tables.has(key)) { tables.set(key, null); continue; }
        tables.set(key, Array.isArray(table.columns) ? table.columns : null);
    }
    return select => {
        if (cache.has(select)) return cache.get(select);
        let labels = [];
        if (select?.kind !== 'Select' || !Array.isArray(select.slots.columns)
            || select.slots.with?.length) return null;
        const sources = select.slots.from || [];
        for (const item of select.slots.columns) {
            if (item?.kind !== 'SelectItem') { labels = null; break; }
            if (typeof item.attrs.as === 'string') { labels.push(item.attrs.as); continue; }
            const column = item.slots.expr;
            if (column?.kind !== 'ColumnReference' || typeof column.attrs.column !== 'string'
                || column.attrs.column === '*' || column.attrs.db != null) { labels = null; break; }
            const matches = [];
            for (const source of sources) {
                if (source?.kind !== 'TableSource' || source.attrs.db != null || source.slots.expr) { labels = null; break; }
                if (column.attrs.table != null && fold(column.attrs.table) !== fold(source.attrs.as ?? source.attrs.table)) continue;
                const columns = tables.get(fold(source.attrs.table));
                if (!columns) { labels = null; break; }
                for (const physical of columns) if (fold(physical.name) === fold(column.attrs.column)) matches.push(physical.name);
            }
            if (labels === null || matches.length !== 1) { labels = null; break; }
            labels.push(matches[0]);
        }
        const result = labels === null ? null : JSON.stringify(labels);
        cache.set(select, result); return result;
    };
}
