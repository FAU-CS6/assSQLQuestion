/**
 * Explicit, reversible SQLite equivalence edges; never parser normalization.
 * These rules concern executed values/constraints, not sqlite_schema spelling.
 * https://www.sqlite.org/lang_altertable.html
 * https://www.sqlite.org/lang_createtable.html#rowid
 * https://www.sqlite.org/quirks.html#double_quoted_string_literals_are_accepted
 * https://www.sqlite.org/foreignkeys.html#fk_indexes
 */
const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
const node = value => value && typeof value.kind === 'string' && value.attrs && value.slots;
const empty = value => value == null || Array.isArray(value) && value.length === 0;
const clean = (values, allowed) => Object.entries(values).every(([key, value]) => allowed.includes(key) || empty(value));
const literals = new Set(['StringLiteral', 'DoubleQuotedLiteral']);
const hiddenRowids = ['rowid', 'oid', '_rowid_'];

function* locations(root, path = []) {
    if (!node(root)) return;
    yield {node: root, path};
    for (const [field, value] of Object.entries(root.slots)) {
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) yield* locations(value[i], [...path, 'slots', field, i]);
        } else yield* locations(value, [...path, 'slots', field]);
    }
}

function schemaCatalog(schema) {
    const tables = new Map();
    const add = (name, columns) => {
        if (typeof name !== 'string' || !Array.isArray(columns)) return;
        const names = columns.map(c => typeof c === 'string' ? c : c?.name);
        if (names.some(n => typeof n !== 'string')) return;
        tables.set(fold(name), new Set(names.map(fold)));
    };
    if (Array.isArray(schema?.tables)) for (const table of schema.tables) add(table.name, table.columns);
    else for (const [name, columns] of Object.entries(schema || {})) add(name, columns);
    return tables;
}

const tableName = n => n?.slots?.table?.length === 1 && n.slots.table[0].attrs.db == null
    ? fold(n.slots.table[0].attrs.table) : null;
const columnNames = definitions => {
    const names = [];
    for (const d of definitions || []) {
        if (d?.attrs?.resource !== 'COLUMN') continue;
        const name = d.slots.column?.attrs.column;
        if (typeof name !== 'string') return null;
        names.push(fold(name));
    }
    return names.length ? new Set(names) : null;
};

// Unknown derived output names make name resolution unknown, not empty.
function outputNames(query, tables) {
    if (query?.kind === 'Subquery') return outputNames(query.slots.ast, tables);
    if (query?.kind === 'CompoundSelect') return outputNames(query.slots.left, tables);
    if (query?.kind !== 'Select') return null;
    const names = new Set();
    for (const item of query.slots.columns || []) {
        if (typeof item?.attrs?.as === 'string') { names.add(fold(item.attrs.as)); continue; }
        const expr = item?.slots?.expr;
        if (expr?.kind === 'ColumnReference' && typeof expr.attrs.column === 'string' && expr.attrs.column !== '*') {
            names.add(fold(expr.attrs.column)); continue;
        }
        if (expr?.kind !== 'Asterisk' && !(expr?.kind === 'ColumnReference' && expr.attrs.column === '*')) return null;
        const sources = (query.slots.from || []).filter(s => expr.attrs.table == null
            || fold(s.attrs.as ?? s.attrs.table) === fold(expr.attrs.table));
        if (!sources.length) return null;
        for (const source of sources) {
            const columns = source.slots.expr ? outputNames(source.slots.expr, tables)
                : source.attrs.db == null ? tables.get(fold(source.attrs.table)) : null;
            if (!columns) return null;
            columns.forEach(name => names.add(name));
        }
    }
    return names;
}

/**
 * Find literals whose spelling may switch between SQLite DQS and SQS.
 * Recheck each current graph state: an edit can introduce a binding that did
 * not exist in the original query. Missing schema knowledge never proves that
 * a double-quoted name is unbound. Aliases/correlated scopes and implicit rowid
 * names are included conservatively. Unaliased projections are excluded since
 * changing their source spelling can change the returned column name.
 *
 * Consumers of heuristic facts can use these occurrence paths to abstract the
 * two spellings together. The actual AST must still change through an edit.
 */
export function sqliteStringQuoteCandidates(root, schema = {}, preparedCatalog = schemaCatalog(schema)) {
    const candidates = [];
    const constant = {complete: true, names: new Set(), parent: null};
    const unbound = (name, scope) => {
        if (!scope) return false;
        for (let s = scope; s; s = s.parent) if (!s.complete || s.names.has(fold(name))) return false;
        return true;
    };
    const visit = (n, path, scope, tables, allowed = true) => {
        if (!node(n)) return;
        // CTE name shadowing is handled below for SELECTs. Do not accidentally
        // use a global table's columns for an unhandled WITH-DML grammar.
        if (n.slots.with?.length && !['Select', 'CompoundSelect'].includes(n.kind)) return;
        const child = (value, field, childScope = scope, childTables = tables, childAllowed = allowed) => {
            if (Array.isArray(value)) value.forEach((v, i) => visit(v, [...path, 'slots', field, i], childScope, childTables, childAllowed));
            else visit(value, [...path, 'slots', field], childScope, childTables, childAllowed);
        };
        if (n.kind === 'Script') {
            const local = new Map(tables);
            let completeCatalog = Array.isArray(schema?.tables);
            (n.slots.statements || []).forEach((statement, i) => {
                visit(statement, [...path, 'slots', 'statements', i], null, local, allowed);
                const name = tableName(statement);
                if (statement.kind === 'Create' && statement.attrs.keyword === 'TABLE' && name) {
                    const columns = columnNames(statement.slots.create_definitions);
                    // IF NOT EXISTS may retain an existing table that an
                    // incomplete schema did not describe. Its declared names
                    // cannot then prove a later quoted name to be unbound.
                    if (statement.attrs.if_not_exists && (local.has(name) || !completeCatalog)) return;
                    if (columns) local.set(name, columns); else local.delete(name);
                } else if (statement.kind === 'Alter' && name) {
                    const columns = local.has(name) ? new Set(local.get(name)) : null;
                    let known = !!columns;
                    for (const action of statement.slots.expr || []) {
                        const column = fold(action.slots.column?.attrs.column);
                        if (action.attrs.resource !== 'COLUMN' || typeof column !== 'string') { known = false; break; }
                        if (action.attrs.action === 'ADD') columns?.add(column);
                        else if (action.attrs.action === 'DROP') columns?.delete(column);
                        else { known = false; break; }
                    }
                    if (known) local.set(name, columns);
                    else { local.delete(name); completeCatalog = false; }
                } else if (statement.kind === 'Drop' && name) local.delete(name);
                // An unknown CREATE VIEW/RENAME may shadow known relations.
                else if (statement.kind === 'Create' || statement.kind === 'Alter') { local.clear(); completeCatalog = false; }
            });
            return;
        }
        if (n.kind === 'Create' && n.attrs.keyword === 'TABLE') {
            const names = columnNames(n.slots.create_definitions);
            const checkScope = {complete: !!names, names: names || new Set(), parent: null};
            (n.slots.create_definitions || []).forEach((d, i) => {
                for (const [field, value] of Object.entries(d.slots || {})) {
                    const s = field === 'check' ? checkScope : field === 'default_val' ? constant : null;
                    const base = [...path, 'slots', 'create_definitions', i, 'slots', field];
                    if (Array.isArray(value)) value.forEach((v, j) => visit(v, [...base, j], s, tables, allowed));
                    else visit(value, base, s, tables, allowed);
                }
            });
            if (n.slots.select) child(n.slots.select, 'select', null);
            return;
        }
        if (n.kind === 'Alter' && n.slots.table) {
            const name = tableName(n), existing = tables.get(name), names = new Set(existing || []);
            let complete = !!existing;
            for (const action of n.slots.expr || []) {
                if (action.attrs.action !== 'ADD' || action.attrs.resource !== 'COLUMN') { complete = false; continue; }
                const added = action.slots.column?.attrs.column;
                if (typeof added !== 'string') complete = false; else names.add(fold(added));
            }
            const checkScope = {complete, names, parent: null};
            (n.slots.expr || []).forEach((action, i) => {
                for (const [field, value] of Object.entries(action.slots || {})) {
                    const s = field === 'check' ? checkScope : field === 'default_val' ? constant : null;
                    const base = [...path, 'slots', 'expr', i, 'slots', field];
                    if (Array.isArray(value)) value.forEach((v, j) => visit(v, [...base, j], s, tables, allowed));
                    else visit(value, base, s, tables, allowed);
                }
            });
            return;
        }
        if (['Select', 'CompoundSelect'].includes(n.kind)) {
            const local = new Map(tables);
            const ctes = n.slots.with || [];
            const cteName = c => fold(c.slots.name?.attrs.value ?? c.attrs.name);
            for (const cte of ctes) local.delete(cteName(cte));
            for (const cte of ctes) {
                const explicit = (cte.slots.columns || []).map(c => fold(c.attrs.column ?? c.attrs.value));
                const names = explicit.length && explicit.every(s => typeof s === 'string') ? new Set(explicit) : outputNames(cte.slots.stmt, local);
                if (names) local.set(cteName(cte), names);
            }
            child(ctes, 'with', null, local);
            if (n.kind === 'CompoundSelect') {
                child(n.slots.left, 'left', scope, local); child(n.slots.right, 'right', scope, local);
                // Compound ORDER BY name lookup has special rules; no shortcut.
                return;
            }
            const names = new Set(), sources = n.slots.from || [];
            let complete = true;
            for (const source of sources) {
                const columns = source.slots.expr ? outputNames(source.slots.expr, local)
                    : source.attrs.db == null ? local.get(fold(source.attrs.table)) : null;
                if (!columns) complete = false; else columns.forEach(name => names.add(name));
                hiddenRowids.forEach(name => names.add(name));
            }
            // Including aliases even in the SELECT list is conservative.
            for (const item of n.slots.columns || []) if (typeof item?.attrs?.as === 'string') names.add(fold(item.attrs.as));
            const current = {complete, names, parent: scope};
            for (const [field, value] of Object.entries(n.slots)) {
                if (field === 'with' || field === 'from') continue;
                if (field === 'columns') value.forEach((item, i) => visit(item, [...path, 'slots', field, i], current, local,
                    allowed && typeof item?.attrs?.as === 'string'));
                else child(value, field, current, local);
            }
            sources.forEach((source, i) => {
                const base = [...path, 'slots', 'from', i, 'slots'];
                visit(source.slots.expr, [...base, 'expr'], null, local, allowed);
                visit(source.slots.on, [...base, 'on'], current, local, allowed);
            });
            return;
        }
        if (n.kind === 'Update' || n.kind === 'Delete') {
            const sources = [...(n.slots.table || []), ...(n.slots.from || [])], names = new Set(hiddenRowids);
            let complete = sources.length > 0;
            for (const source of sources) {
                const columns = source.attrs.db == null && tables.get(fold(source.attrs.table));
                if (!columns) complete = false; else columns.forEach(name => names.add(name));
            }
            const current = {complete, names, parent: scope};
            for (const [field, value] of Object.entries(n.slots)) child(value, field, current);
            return;
        }
        if (allowed && literals.has(n.kind) && typeof n.attrs.value === 'string'
            && clean(n.attrs, ['value']) && unbound(n.attrs.value, scope)) candidates.push({node: n, path});
        for (const [field, value] of Object.entries(n.slots)) child(value, field);
    };
    visit(root, [], null, preparedCatalog);
    return candidates;
}

function primaryKeyCatalog(schema) {
    const result = new Map();
    for (const table of schema?.tables || []) {
        if (typeof table.name !== 'string' || !Array.isArray(table.columns)) continue;
        // A boolean "is primary key" loses composite-key order. Require the
        // actual PRAGMA table_info ordinal, never infer it from array position.
        const columns = table.columns.filter(c => Number.isInteger(c?.pk) && c.pk > 0).sort((a, b) => a.pk - b.pk);
        if (columns.length && columns.every((c, i) => c.pk === i + 1 && typeof c.name === 'string')
            && new Set(columns.map(c => fold(c.name))).size === columns.length) {
            result.set(fold(table.name), columns.map(c => fold(c.name)));
        }
    }
    return result;
}

const plainColumn = n => n?.kind === 'ColumnReference' && typeof n.attrs.column === 'string'
    && n.attrs.column !== '*' && n.attrs.table == null && clean(n.attrs, ['column', 'table']) && clean(n.slots, []);
function declaredPrimaryKey(table) {
    const defs = table.slots.create_definitions || [], names = columnNames(defs);
    const keys = defs.filter(d => d.attrs.primary_key != null || d.attrs.constraint_type === 'PRIMARY KEY');
    if (!names || keys.length !== 1) return null;
    const key = keys[0];
    const columns = key.attrs.resource === 'COLUMN' && key.attrs.primary_key === 'PRIMARY KEY'
        ? [key.slots.column] : key.attrs.resource === 'CONSTRAINT' && key.attrs.constraint_type === 'PRIMARY KEY'
            ? key.slots.definition : null;
    if (!Array.isArray(columns) || !columns.length || !columns.every(plainColumn)) return null;
    const values = columns.map(c => fold(c.attrs.column));
    return new Set(values).size === values.length && values.every(v => names.has(v)) ? values : null;
}

/** Proven parent-PK lists for explicit/implicit FK edits, in script order. */
export function sqliteForeignKeyColumnCandidates(root, schema = {}, prepared = {
    keys: primaryKeyCatalog(schema), tables: new Set((schema?.tables || []).map(t => fold(t.name))), complete: Array.isArray(schema?.tables)
}) {
    const result = [], catalog = new Map(prepared.keys), knownTables = new Set(prepared.tables);
    let completeCatalog = prepared.complete;
    const statements = root?.kind === 'Script' ? root.slots.statements || [] : [];
    statements.forEach((statement, i) => {
        const name = tableName(statement), scope = new Map(catalog);
        const definitelyCreated = !statement.attrs.if_not_exists || completeCatalog && !knownTables.has(name);
        if (statement.kind === 'Create' && statement.attrs.keyword === 'TABLE' && name
            && !knownTables.has(name) && definitelyCreated) {
            const pk = declaredPrimaryKey(statement);
            if (pk) scope.set(name, pk); // Includes provable self-references.
        }
        if (statement.kind === 'Create' || statement.kind === 'Alter') {
            for (const {node: d, path} of locations(statement, ['slots', 'statements', i])) {
                const ref = d.slots.reference_definition;
                if (ref?.kind !== 'ReferenceDefinition' || ref.attrs.keyword !== 'REFERENCES') continue;
                const arity = d.attrs.resource === 'COLUMN' ? 1
                    : d.attrs.constraint_type === 'FOREIGN KEY' && Array.isArray(d.slots.definition)
                        && d.slots.definition.every(plainColumn) ? d.slots.definition.length : 0;
                const pk = scope.get(tableName(ref));
                if (!arity || !pk || pk.length !== arity) continue;
                const columns = ref.slots.definition;
                const implicit = ref.attrs.implicit_columns === true && columns == null;
                const explicit = ref.attrs.implicit_columns == null && Array.isArray(columns) && columns.length === pk.length
                    && columns.every((c, index) => plainColumn(c) && fold(c.attrs.column) === pk[index]);
                if (implicit || explicit) result.push({node: ref, path: [...path, 'slots', 'reference_definition'], columns: pk, implicit});
            }
        }
        if (statement.kind === 'Create' && statement.attrs.keyword === 'TABLE' && name) {
            if (!knownTables.has(name) && definitelyCreated) {
                const pk = declaredPrimaryKey(statement);
                if (pk) catalog.set(name, pk);
            }
            knownTables.add(name);
        } else if (['Alter', 'Drop'].includes(statement.kind) && name) {
            catalog.delete(name);
            if (statement.kind === 'Drop') knownTables.delete(name);
            else completeCatalog = false;
        } else if (['Alter', 'Create', 'Drop'].includes(statement.kind)) { catalog.clear(); completeCatalog = false; }
    });
    return result;
}

const observesSchema = root => [...locations(root)].some(({node: n}) => /pragma/i.test(n.kind)
    || n.kind === 'TableSource' && /^(?:pragma_|sqlite_)/i.test(n.attrs.table || ''));

export const SQLITE_EQUIVALENCE_STEPS = Object.freeze([
    {id: 'toggleAlterAddColumnKeyword', label: 'Use or omit COLUMN in ALTER TABLE ADD', defaultCost: 0},
    {id: 'quoteUnboundSqliteString', label: 'Change quotes of an unbound SQLite string literal', defaultCost: 0},
    {id: 'toggleIntegerPrimaryKeyNotNull', label: 'Use or omit redundant NOT NULL on a SQLite INTEGER rowid primary key', defaultCost: 0},
    {id: 'toggleExplicitPrimaryKeyReference', label: 'Use or omit a proven parent primary-key column list in a foreign key', defaultCost: 0}
]);

/** Register with graph-edits' ordinary register callback, including cost overrides. */
export function registerSQLiteEquivalences(register, schema = {}, {doubleQuotedStrings = true, schemaMetadataObserved = false} = {}) {
    const annotations = {maxNewSymbols: 0, preservesSymbolSet: true};
    const [alter, quote, nullable, foreignKey] = SQLITE_EQUIVALENCE_STEPS;
    // Schema indexes are prepared once per graph; occurrence-sensitive guards
    // are cached only for the same immutable graph root, never across states.
    const quoteCatalog = schemaCatalog(schema), quoteCache = new WeakMap(), fkCache = new WeakMap();
    const pkCatalog = {keys: primaryKeyCatalog(schema), tables: new Set((schema?.tables || []).map(t => fold(t.name))), complete: Array.isArray(schema?.tables)};
    register(alter.id, alter.label, alter.defaultCost, function* (root) {
        for (const {node: n, path} of locations(root)) if (n.kind === 'Alter' && n.attrs.action === 'ADD'
            && n.attrs.resource === 'COLUMN' && (n.attrs.keyword == null || n.attrs.keyword === 'COLUMN')) {
            yield {path, after: {...n, attrs: {...n.attrs, keyword: n.attrs.keyword === 'COLUMN' ? null : 'COLUMN'}}};
        }
    // SQLite discards this optional keyword before storing the new column's
    // definition. Unlike declaration rewrites it preserves sqlite_master.sql
    // and PRAGMA metadata, too. EXPLAIN remains protected by the registry.
    }, {...annotations, preservesSchemaMetadata: true});
    register(quote.id, quote.label, quote.defaultCost, function* (root) {
        if (!doubleQuotedStrings || schemaMetadataObserved || observesSchema(root)) return;
        if (!quoteCache.has(root)) quoteCache.set(root, sqliteStringQuoteCandidates(root, schema, quoteCatalog));
        for (const {node: n, path} of quoteCache.get(root)) {
            yield {path, after: {...n, kind: n.kind === 'StringLiteral' ? 'DoubleQuotedLiteral' : 'StringLiteral'}};
        }
    // Before enabling this free edge, the graph's symbol/predicate abstractions
    // must merge these two literal kinds at the guarded occurrence paths.
    }, {...annotations, preservesSymbolSet: false});
    register(nullable.id, nullable.label, nullable.defaultCost, function* (root) {
        if (schemaMetadataObserved || observesSchema(root)) return;
        for (const {node: table, path} of locations(root)) {
            if (table.kind !== 'Create' || table.attrs.keyword !== 'TABLE' || !empty(table.slots.table_options)) continue;
            const defs = table.slots.create_definitions || [];
            // Inline, exactly INTEGER PRIMARY KEY only. In particular exclude
            // INT, composite keys, PRIMARY KEY DESC, STRICT and WITHOUT ROWID.
            const pks = defs.filter(d => d.attrs.primary_key != null || d.attrs.constraint_type === 'PRIMARY KEY');
            if (pks.length !== 1) continue;
            const d = pks[0], type = d.slots.definition, value = d.slots.nullable;
            if (d.kind !== 'Definition' || d.attrs.resource !== 'COLUMN' || d.attrs.primary_key !== 'PRIMARY KEY'
                || !clean(d.attrs, ['resource', 'primary_key', 'auto_increment'])
                || !clean(d.slots, ['column', 'definition', 'nullable', 'reference_definition', 'default_val', 'check'])
                || type?.kind !== 'DataType' || type.attrs.dataType !== 'INTEGER'
                || !clean(type.attrs, ['dataType']) || !clean(type.slots, [])
                || value != null && !(value.kind === 'NotNull' && value.attrs.value === 'not null'
                    && clean(value.attrs, ['value']) && clean(value.slots, []))) continue;
            const slots = {...d.slots};
            if (value) delete slots.nullable;
            else slots.nullable = {kind: 'NotNull', attrs: {value: 'not null'}, slots: {}};
            yield {path: [...path, 'slots', 'create_definitions', defs.indexOf(d)], after: {...d, slots}};
        }
    }, annotations);
    register(foreignKey.id, foreignKey.label, foreignKey.defaultCost, function* (root) {
        if (schemaMetadataObserved || observesSchema(root)) return;
        if (!fkCache.has(root)) fkCache.set(root, sqliteForeignKeyColumnCandidates(root, schema, pkCatalog));
        for (const {node: ref, path, columns, implicit} of fkCache.get(root)) {
            const attrs = {...ref.attrs}, slots = {...ref.slots};
            if (implicit) {
                delete attrs.implicit_columns;
                slots.definition = columns.map(column => ({kind: 'ColumnReference', attrs: {table: null, column}, slots: {collate: null}}));
            } else { attrs.implicit_columns = true; slots.definition = null; }
            yield {path, after: {...ref, attrs, slots}};
        }
    }, {...annotations, preservesSymbolSet: false});
}

/**
 * A coarse VIEW FOR ADMISSIBLE HEURISTIC FACTS ONLY. This must never be used as
 * a graph vertex, graph key, distance result or a replacement for the edits.
 * Deliberately coarser and context independent: a paid table-name edit must
 * not introduce extra symbol facts merely by looking up a different parent's
 * PK. Consequently FK target-column lists are forgotten rather than expanded.
 * Nonzero teacher costs and blocked equivalences may also use this weaker
 * abstraction: forgetting distinctions weakens rather than inflates a bound.
 */
export function createSQLiteEquivalenceFactView() {
    const cache = new WeakMap();
    const view = n => {
        if (!node(n)) return n;
        if (cache.has(n)) return cache.get(n);
        let changed = false, attrs = n.attrs;
        const kind = n.kind === 'DoubleQuotedLiteral' ? 'StringLiteral' : n.kind;
        const slots = {};
        // Only the inline INTEGER PRIMARY KEY family has a free NOT NULL
        // toggle. This deliberately includes some guarded-out cases (DESC,
        // metadata observers, WITHOUT ROWID); forgetting extra distinctions
        // weakens guidance safely. Ordinary CREATE/ALTER constraints remain
        // evidence for the binary one-paid-edit predicate bound. A paid type
        // or PK change can affect many predicate facts, but never more than
        // that bound's single unit. Symbol facts do not depend on nullable.
        const nullableMayBeFree = n.kind === 'Definition' && n.attrs.primary_key === 'PRIMARY KEY'
            && n.slots.definition?.kind === 'DataType' && n.slots.definition.attrs.dataType === 'INTEGER';
        for (const [field, value] of Object.entries(n.slots)) {
            if (field === 'nullable' && nullableMayBeFree) { changed = true; continue; }
            if (n.kind === 'ReferenceDefinition' && field === 'definition') {
                slots[field] = null; changed ||= value !== null; continue;
            }
            if (Array.isArray(value)) {
                const mapped = value.map(view);
                slots[field] = mapped.every((v, i) => v === value[i]) ? value : mapped;
            } else slots[field] = view(value);
            changed ||= slots[field] !== value;
        }
        if (n.kind === 'ReferenceDefinition' && Object.hasOwn(attrs, 'implicit_columns')) {
            attrs = {...attrs}; delete attrs.implicit_columns;
        }
        if (n.kind === 'Alter' && attrs.action === 'ADD' && attrs.resource === 'COLUMN' && attrs.keyword != null) {
            attrs = {...attrs, keyword: null};
        }
        const result = changed || attrs !== n.attrs || kind !== n.kind ? {...n, kind, attrs, slots} : n;
        cache.set(n, result); return result;
    };
    return view;
}

const defaultFactView = createSQLiteEquivalenceFactView();
export const sqliteEquivalenceFactView = root => defaultFactView(root);
