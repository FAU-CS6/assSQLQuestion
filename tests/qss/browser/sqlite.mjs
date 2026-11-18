// Test-only API adapter. Every operation uses the shipped SQLite 3.22.0
// browser asset; importing node:sqlite must never execute SQL on Node.
export class DatabaseSync {
    constructor(filename = ':memory:', options = {}) {
        if (filename !== ':memory:') throw new Error('Only anonymous in-memory test databases are supported.');
        if (Object.keys(options).some(key => key !== 'enableDoubleQuotedStringLiterals')
            || options.enableDoubleQuotedStringLiterals === false) throw new Error('Unsupported SQLite test option.');
        this.db = new globalThis.SQL.Database();
    }
    exec(sql) { this.db.run(sql); }
    function(name, options, fn) { this.db.create_function(name, fn || options); }
    prepare(sql) {
        // Prepare immediately, so syntax errors are thrown at the same call
        // boundary as the existing tests expect. Database.close frees statements.
        const stmt = this.db.prepare(sql);
        let names = [], bigInts = false, started = false, hasRow = false;
        const begin = () => {
            if (!started) {
                hasRow = stmt.step();
                names = stmt.getColumnNames();
                started = true;
            }
        };
        const reset = () => { stmt.reset(); started = false; };
        const row = () => {
            const values = stmt.get();
            return Object.fromEntries(names.map((name, i) => {
                let value = values[i];
                if (bigInts && typeof value === 'number') {
                    // SQLite's own textual INTEGER representation is exact;
                    // its REAL representation includes a decimal or exponent.
                    // Reading that native text avoids JS Number precision loss.
                    const text = stmt.getString(i);
                    if (/^-?\d+$/.test(text)) value = BigInt(text);
                }
                return [name, value];
            }));
        };
        return {
            all() {
                try {
                    begin();
                    const rows = [];
                    if (hasRow) do { rows.push(row()); } while (stmt.step());
                    return rows;
                } finally { reset(); }
            },
            get() {
                try { begin(); return hasRow ? row() : undefined; }
                finally { reset(); }
            },
            columns() {
                begin();
                // This old SQL.js exposes names only after the first row.
                if (!hasRow) throw new Error('Column metadata for an empty result is unavailable in the shipped SQL.js API.');
                return names.map(name => ({name}));
            },
            setReadBigInts(value) { bigInts = value; }
        };
    }
    close() { this.db.close(); }
}
