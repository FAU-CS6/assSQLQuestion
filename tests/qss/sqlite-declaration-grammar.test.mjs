import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';

const parse = sql => parseGraphSql(sql, {allowPartial: false}).root;
const all = (root, kind) => [...walkNodes(root)].map(entry => entry.node).filter(node => node.kind === kind);
const statement = sql => parse(sql).slots.statements[0];

test('named column constraints and all conflict policies remain structured and distinguishable', () => {
    const sql = "CREATE TABLE t(id INTEGER CONSTRAINT pk PRIMARY KEY ASC ON CONFLICT REPLACE, x TEXT CONSTRAINT nn NOT NULL ON CONFLICT FAIL CONSTRAINT uq UNIQUE ON CONFLICT IGNORE CONSTRAINT d DEFAULT 'v', y INTEGER CONSTRAINT ck CHECK(y>0), z TEXT CONSTRAINT co COLLATE NOCASE)";
    const root = parse(sql), definitions = root.slots.statements[0].slots.create_definitions;
    assert.equal(definitions[0].attrs.primary_key_constraint, 'pk');
    assert.equal(definitions[0].attrs.primary_key_order, 'ASC');
    assert.equal(definitions[0].attrs.primary_key_conflict, 'REPLACE');
    assert.equal(definitions[1].slots.nullable.attrs.constraint, 'nn');
    assert.equal(definitions[1].slots.nullable.attrs.on_conflict, 'FAIL');
    assert.equal(definitions[1].attrs.unique_constraint, 'uq');
    assert.equal(definitions[1].attrs.unique_conflict, 'IGNORE');
    assert.equal(definitions[1].slots.default_val.attrs.constraint, 'd');
    assert.equal(definitions[2].slots.check.attrs.constraint, 'ck');
    assert.equal(definitions[3].slots.collate.attrs.constraint, 'co');
    for (const action of ['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE']) {
        assert.equal(statement('CREATE TABLE t(x NOT NULL ON CONFLICT ' + action + ')').slots.create_definitions[0].slots.nullable.attrs.on_conflict, action);
    }
    for (const [before, after] of [['CONSTRAINT nn', 'CONSTRAINT other'], ['CONFLICT FAIL', 'CONFLICT ABORT'], ['KEY ASC', 'KEY DESC'], ["DEFAULT 'v'", "DEFAULT 'w'"]]) {
        assert.notEqual(stableKey(root), stableKey(parse(sql.replace(before, after))));
    }
    const alter = statement("ALTER TABLE t ADD COLUMN label TEXT CONSTRAINT nn NOT NULL ON CONFLICT FAIL DEFAULT 'new'");
    assert.equal(alter.slots.expr[0].slots.nullable.attrs.constraint, 'nn');
    assert.equal(alter.slots.expr[0].attrs.keyword, 'COLUMN');
    const fk = all(parse('CREATE TABLE t(x CONSTRAINT fk REFERENCES p(id) ON DELETE SET NULL NOT DEFERRABLE INITIALLY IMMEDIATE)'), 'ReferenceDefinition')[0];
    assert.equal(fk.attrs.constraint, 'fk'); assert.equal(fk.attrs.deferrable, 'NOT DEFERRABLE');
    assert.equal(fk.attrs.initially, 'IMMEDIATE'); assert.equal(fk.slots.on_action.length, 1);
});

test('multiple CHECKs and indexed-column directions never disappear', () => {
    const root = parse('CREATE TABLE t(x INTEGER CHECK(x>0) CHECK(x<10), y, CONSTRAINT pk PRIMARY KEY(x DESC,y ASC) ON CONFLICT IGNORE)');
    assert.equal(all(root, 'Check').length, 2);
    const pk = root.slots.statements[0].slots.create_definitions[2];
    assert.deepEqual(pk.slots.definition.map(node => node.attrs.sort_order), ['DESC', 'ASC']);
    assert.equal(pk.attrs.on_conflict, 'IGNORE');
    for (const [a, b] of [['x>0', 'x>1'], ['x<10', 'x<11'], ['x DESC', 'x ASC'], ['y ASC', 'y DESC']]) {
        const sql = 'CREATE TABLE t(x CHECK(x>0) CHECK(x<10),y,PRIMARY KEY(x DESC,y ASC))';
        assert.notEqual(stableKey(parse(sql)), stableKey(parse(sql.replace(a, b))));
    }
    assert.equal(statement('CREATE TABLE t(x, CHECK(x>0) ON CONFLICT FAIL)').slots.create_definitions[1].attrs.on_conflict, 'FAIL');
    assert.equal(all(parse('CREATE TABLE t(x CONSTRAINT a CHECK(x>0) CONSTRAINT b CHECK(x<10))'), 'Check').length, 2);
});

test('foreign-key MATCH clauses are distinct from full-text MATCH expressions', () => {
    const sql = 'CREATE TABLE parent(a PRIMARY KEY);CREATE TABLE child(x REFERENCES parent(a) MATCH SIMPLE ON UPDATE CASCADE ON DELETE SET NULL);SELECT * FROM child';
    const root = parse(sql), reference = all(root, 'ReferenceDefinition')[0];
    assert.equal(reference.attrs.match, 'match simple'); assert.equal(reference.slots.on_action.length, 2);
    assert.equal(all(root, 'BinaryExpression').filter(node => node.attrs.operator === 'MATCH').length, 0);
    for (const match of ['SIMPLE', 'FULL', 'PARTIAL']) {
        const foreign = all(parse('CREATE TABLE child(x,FOREIGN KEY(x) REFERENCES parent(a) MATCH ' + match + ')'), 'ReferenceDefinition')[0];
        assert.equal(foreign.attrs.match, 'match ' + match.toLowerCase());
    }
    const mixed = parse("CREATE TABLE child(x REFERENCES parent(a) MATCH SIMPLE, y CHECK(y MATCH 'query'))");
    assert.equal(all(mixed, 'ReferenceDefinition')[0].attrs.match, 'match simple');
    assert.equal(all(mixed, 'BinaryExpression').filter(node => node.attrs.operator === 'MATCH').length, 1);
    assert.equal(all(parse("SELECT content FROM docs WHERE content MATCH 'query'"), 'BinaryExpression')[0].attrs.operator, 'MATCH');
    assert.throws(() => parse('CREATE TABLE child(x REFERENCES parent(a) MATCH)'));
    assert.throws(() => parse('CREATE TABLE child(x REFERENCES parent(a) MATCH SIMPLE GARBAGE)'));
});

test('PRIMARY KEY DESC and annotated constraints block the narrow rowid NOT NULL free edit', () => {
    for (const sql of ['CREATE TABLE t(id INTEGER PRIMARY KEY DESC NOT NULL)',
        'CREATE TABLE t(id INTEGER PRIMARY KEY ASC NOT NULL)',
        'CREATE TABLE t(id INTEGER CONSTRAINT named_pk PRIMARY KEY NOT NULL)',
        'CREATE TABLE t(id INTEGER PRIMARY KEY ON CONFLICT REPLACE NOT NULL)']) {
        const root = parse(sql), graph = createEditGraph(root, root, {});
        const edit = graph.edits.find(item => item.name === 'toggleIntegerPrimaryKeyNotNull');
        assert.equal([...edit.apply(root)].length, 0, sql);
    }
    assert.notEqual(stableKey(parse('CREATE TABLE t(id INTEGER PRIMARY KEY DESC)')), stableKey(parse('CREATE TABLE t(id INTEGER PRIMARY KEY ASC)')));
});

test('FTS3 and FTS4 declarations retain module, schema, columns and each real option', () => {
    const sql = "CREATE VIRTUAL TABLE IF NOT EXISTS main.docs USING fts4(title,body,tokenize=porter,prefix='2,3',notindexed=title,order=DESC)";
    const root = parse(sql), create = root.slots.statements[0], module = create.slots.module;
    assert.equal(create.attrs.virtual, true); assert.equal(module.attrs.name, 'fts4');
    assert.equal(create.slots.table[0].attrs.db, 'main');
    assert.equal(module.slots.arguments.length, 6);
    assert.equal(all(root, 'FtsColumn').length, 2);
    assert.deepEqual(all(root, 'FtsOption').map(node => node.attrs.name), ['tokenize', 'prefix', 'notindexed', 'order']);
    for (const [before, after] of [['fts4', 'fts3'], ['title,body', 'subject,body'], ['porter', 'simple'], ["'2,3'", "'3,4'"], ['DESC', 'ASC']]) {
        assert.notEqual(stableKey(root), stableKey(parse(sql.replace(before, after))));
    }
    for (const node of all(root, 'FtsOption')) assert.ok(node.slots.values.length);
    assert.equal(statement('CREATE VIRTUAL TABLE docs USING fts3').slots.module.attrs.name, 'fts3');
    for (const [value, storageClass] of [['9007199254740993', 'integer'], ['2.0', 'real'], ['9223372036854775808', 'real']]) {
        const number = all(parse('CREATE VIRTUAL TABLE docs USING fts4(body,prefix=' + value + ')'), 'NumberLiteral')[0];
        assert.deepEqual(number.attrs, {value, storageClass});
    }
});

test('trigger SELECT bodies preserve numeric precision CASE boundaries and following statements', () => {
    const sql = "CREATE TRIGGER tr BEFORE UPDATE OF a,b ON t FOR EACH ROW WHEN NEW.a>0 BEGIN SELECT CASE WHEN NEW.a=1 THEN 9007199254740993 ELSE 2 END;INSERT INTO log VALUES(NEW.a); END;SELECT 3";
    const root = parse(sql), trigger = root.slots.statements[0];
    assert.equal(root.slots.statements.length, 2);
    assert.equal(trigger.slots.execute.kind, 'TriggerBody');
    assert.equal(trigger.slots.execute.slots.statements.length, 2);
    assert.equal(all(trigger, 'CaseExpression').length, 1);
    assert.ok(all(trigger, 'NumberLiteral').some(node => node.attrs.value === '9007199254740993'));
    assert.notEqual(stableKey(root), stableKey(parse(sql.replace('9007199254740993', '9007199254740992'))));
    assert.notEqual(stableKey(root), stableKey(parse(sql.replace('NEW.a>0', 'NEW.a>1'))));
    assert.equal(statement('CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END').slots.execute.slots.statements[0].kind, 'Select');
    assert.equal(statement('CREATE TEMP TABLE local(a)').slots.table[0].attrs.table, 'local');
    assert.ok(!JSON.stringify(root).includes('__qss_'));
});

test('declaration adapters reject incomplete constraints directions options and trigger tails', () => {
    for (const sql of ['CREATE TABLE t(x CONSTRAINT c)', 'CREATE TABLE t(x NOT NULL ON CONFLICT)',
        'CREATE TABLE t(x NOT NULL ON CONFLICT MYSTERY)', 'CREATE TABLE t(x PRIMARY KEY DESC DESC)',
        'CREATE TABLE t(x,PRIMARY KEY(x DESC) ON CONFLICT FAIL garbage)',
        'CREATE VIRTUAL TABLE f USING fts4(x,tokenize=)', 'CREATE VIRTUAL TABLE f USING fts4(x,prefix=1 2)',
        'CREATE VIRTUAL TABLE f USING fts4(x) trailing', 'CREATE TEMP VIRTUAL TABLE f USING fts4(x)',
        'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1 END',
        'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT CASE WHEN 1 THEN 2; END',
        'CREATE TRIGGER tr AFTER INSERT ON t BEGIN COMMIT; END']) {
        assert.throws(() => parse(sql), undefined, sql);
    }
});

test('multiword and custom type declarations retain their names signed parameters and constraints', () => {
    const sql = 'CREATE TABLE t(a UNSIGNED BIG INT,b DOUBLE PRECISION,c VARYING CHARACTER(20),d CUSTOM TYPE(9007199254740993,-2),e FLOATING POINT)';
    const root = parse(sql), types = all(root, 'DataType');
    assert.deepEqual(types.map(node => node.attrs.dataType), ['UNSIGNED BIG INT','DOUBLE PRECISION','VARYING CHARACTER','CUSTOM TYPE','FLOATING POINT']);
    assert.equal(types[2].attrs.length, '20');
    assert.equal(types[3].attrs.length, '9007199254740993'); assert.equal(types[3].attrs.scale, '-2');
    assert.notEqual(stableKey(root), stableKey(parse(sql.replace('9007199254740993','9007199254740992'))));
    assert.notEqual(stableKey(root), stableKey(parse(sql.replace('CHARACTER(20)','CHARACTER(21)'))));
    assert.notEqual(stableKey(root), stableKey(parse(sql.replace('DOUBLE PRECISION','UNSIGNED BIG INT'))));
    const altered = statement('ALTER TABLE t ADD value DOUBLE PRECISION CONSTRAINT nn NOT NULL DEFAULT 1 CHECK(value>0)');
    assert.equal(altered.slots.expr[0].slots.definition.attrs.dataType, 'DOUBLE PRECISION');
    assert.equal(altered.slots.expr[0].slots.nullable.attrs.constraint, 'nn');
    assert.equal(altered.slots.expr[0].slots.default_val.slots.value.attrs.value, '1');
    assert.equal(all(altered,'Check').length, 1);
    for (const type of ['UNSIGNED BIG INT','FLOATING POINT','CUSTOM INTEGER']) {
        const key = parse('CREATE TABLE t(id '+type+' PRIMARY KEY NOT NULL)');
        assert.equal([...createEditGraph(key,key,{}).edits.find(edit=>edit.name==='toggleIntegerPrimaryKeyNotNull').apply(key)].length,0);
    }
    assert.ok(!JSON.stringify(root).includes('__qss_'));
});

test('typed FTS columns retain declared types and ignored constraints as FTS-specific syntax', () => {
    const root = parse('CREATE VIRTUAL TABLE docs USING fts4(title VARCHAR(256) NOT NULL,body TEXT CHECK(length(body)<10240),rank UNSIGNED BIG INT,tokenize=porter)');
    const columns = all(root,'FtsColumn'); assert.equal(columns.length,3);
    assert.equal(columns[0].slots.definition.attrs.dataType,'VARCHAR'); assert.equal(columns[0].slots.definition.attrs.length,256);
    assert.equal(columns[0].slots.nullable.kind,'NotNull'); assert.equal(all(columns[1],'Check').length,1);
    assert.equal(columns[2].slots.definition.attrs.dataType,'UNSIGNED BIG INT');
    assert.equal(all(root,'Definition').length,0,'FTS declarations must not become ordinary table constraints');
    assert.notEqual(stableKey(root),stableKey(parse('CREATE VIRTUAL TABLE docs USING fts4(title VARCHAR(128) NOT NULL,body TEXT CHECK(length(body)<10240),rank UNSIGNED BIG INT,tokenize=porter)')));
    for(const module of ['fts3','fts4']) assert.equal(statement('CREATE VIRTUAL TABLE docs USING '+module+'()').slots.module.slots.arguments.length,0);
    const repeated=parse('CREATE VIRTUAL TABLE docs USING fts4(x INTEGER CHECK(x>0) CHECK(x<10))');
    assert.equal(all(repeated,'Check').length,2);
    const key=parse('CREATE VIRTUAL TABLE docs USING fts4(id INTEGER PRIMARY KEY NOT NULL)');
    assert.equal([...createEditGraph(key,key,{}).edits.find(edit=>edit.name==='toggleIntegerPrimaryKeyNotNull').apply(key)].length,0);
});

test('invalid extended type parameter syntax is not swallowed by a declaration fallback', () => {
    for(const sql of ['CREATE TABLE t(x DOUBLE PRECISION SELECT)','CREATE TABLE t(x CUSTOM TYPE())',
        'CREATE TABLE t(x CUSTOM TYPE(1,2,3))','CREATE TABLE t(x CUSTOM TYPE(1+2))',
        'CREATE TABLE t(x CUSTOM TYPE(-+2))','CREATE TABLE t(x CUSTOM TYPE(1) extra)',
        'ALTER TABLE t ADD x CUSTOM TYPE(1,)','CREATE VIRTUAL TABLE docs USING fts4(x CUSTOM TYPE(1+2))']) assert.throws(()=>parse(sql));
});

test('SQLite 3.22 oracle verifies multiword affinities and ignored FTS column declarations',
    {skip:!process.env.CHROME_CDP_URL},async t=>{
    const{chromium}=createRequire(import.meta.url)('playwright'),browser=await chromium.connectOverCDP(process.env.CHROME_CDP_URL),context=await browser.newContext();
    context.setDefaultTimeout(0);context.setDefaultNavigationTimeout(0);
    try{
        const page=await context.newPage(),base=process.env.ILIAS_TEST_URL||'http://localhost:8080';
        await page.route(base+'/__type_declaration_oracle__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>SQLite type declarations</title>'}));
        await page.goto(base+'/__type_declaration_oracle__');assert.match(await page.evaluate(()=>navigator.userAgent),/HeadlessChrome/);
        await page.addScriptTag({url:base+'/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/sql.js/sql.js'});
        const observed=await page.evaluate(()=>{
            const run=sql=>{const db=new SQL.Database();try{return db.exec(sql)}finally{db.close()}};
            const declaration='CREATE TABLE t(a UNSIGNED BIG INT,b DOUBLE PRECISION,c VARYING CHARACTER(20),d CUSTOM TYPE(9007199254740993,-2),e FLOATING POINT);';
            const types=run(declaration+'PRAGMA table_info(t)')[0].values.map(row=>row[2]);
            const storage=run(declaration+"INSERT INTO t VALUES('123','123',123,'123','123');SELECT typeof(a),typeof(b),typeof(c),typeof(d),typeof(e) FROM t")[0].values[0];
            const altered=run('CREATE TABLE t(x);ALTER TABLE t ADD amount DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK(amount>0);INSERT INTO t(x)VALUES(7);SELECT amount,typeof(amount) FROM t');
            const fts=[];for(const module of ['fts3','fts4']){
                const ddl='CREATE VIRTUAL TABLE docs USING '+module+'(title VARCHAR(2) NOT NULL,body TEXT CHECK(length(body)<2),rank UNSIGNED BIG INT);';
                const query="INSERT INTO docs VALUES(NULL,'hello world',123);SELECT title,body,rank,typeof(rank) FROM docs WHERE body MATCH 'hello'";
                fts.push({module,info:run(ddl+'PRAGMA table_info(docs)'),rows:run(ddl+query),untypedRows:run('CREATE VIRTUAL TABLE docs USING '+module+'(title,body,rank);'+query),empty:run('CREATE VIRTUAL TABLE docs USING '+module+"();INSERT INTO docs VALUES('hello');SELECT content FROM docs")});
            }
            const integer=run('CREATE TABLE t(id INTEGER PRIMARY KEY);INSERT INTO t VALUES(NULL);SELECT id,rowid FROM t');
            const unsigned=run('CREATE TABLE t(id UNSIGNED BIG INT PRIMARY KEY);INSERT INTO t VALUES(NULL);SELECT id,rowid FROM t');
            return{version:run('SELECT sqlite_version()')[0].values[0][0],types,storage,altered,fts,integer,unsigned};
        });
        assert.equal(observed.version,'3.22.0');
        assert.deepEqual(observed.types,['UNSIGNED BIG INT','DOUBLE PRECISION','VARYING CHARACTER(20)','CUSTOM TYPE(9007199254740993,-2)','FLOATING POINT']);
        assert.deepEqual(observed.storage,['integer','real','text','integer','integer']);
        assert.deepEqual(observed.altered[0].values,[[1,'real']]);
        for(const fts of observed.fts){assert.deepEqual(fts.info[0].values.map(row=>row[2]),['','','']);assert.equal(fts.rows[0].values[0][0],null);assert.equal(fts.rows[0].values[0][1],'hello world');assert.deepEqual(fts.rows,fts.untypedRows);assert.deepEqual(fts.empty[0].values,[['hello']]);}
        assert.notDeepEqual(observed.integer,observed.unsigned);
        t.diagnostic('SQLite3.22:five preserved type declarations/affinities, ALTER constraints, FTS3/4 ignored types/constraints and empty modules, non-rowid PK counterexample');
    }finally{await context.close();await browser.close();}
});

test('SQLite 3.22 browser oracle checks declaration semantics and relevant counterexamples',
    {skip: !process.env.CHROME_CDP_URL}, async t => {
    const {chromium} = createRequire(import.meta.url)('playwright');
    const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL), context = await browser.newContext();
    context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    try {
        const page = await context.newPage(), base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
        await page.route(base + '/__declaration_oracle__', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Declaration oracle</title>'}));
        await page.goto(base + '/__declaration_oracle__');
        assert.match(await page.evaluate(() => navigator.userAgent), /HeadlessChrome/);
        await page.addScriptTag({url: base + '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/sql.js/sql.js'});
        const result = await page.evaluate(() => {
            const run = sql => { const db = new SQL.Database(); try { return db.exec(sql); } finally { db.close(); } };
            const version = run('SELECT sqlite_version()')[0].values[0][0], positives = [], distinctions = [];
            for (const sql of [
                "CREATE TABLE t(id INTEGER CONSTRAINT nn NOT NULL ON CONFLICT FAIL,code TEXT CONSTRAINT uq UNIQUE ON CONFLICT IGNORE,CONSTRAINT ck CHECK(id>0));INSERT INTO t VALUES(1,'a'),(2,'a');SELECT * FROM t",
                'CREATE TABLE t(x CHECK(x>0) CHECK(x<10));INSERT INTO t VALUES(5);SELECT * FROM t',
                'CREATE TABLE t(a,b,PRIMARY KEY(a DESC,b ASC) ON CONFLICT IGNORE);INSERT INTO t VALUES(1,2),(1,2);SELECT * FROM t',
                'CREATE TABLE t(x, CHECK(x>0) ON CONFLICT FAIL);INSERT INTO t VALUES(1);SELECT * FROM t',
                'CREATE TABLE parent(a PRIMARY KEY);CREATE TABLE child(x REFERENCES parent(a) MATCH SIMPLE ON UPDATE CASCADE ON DELETE SET NULL);INSERT INTO parent VALUES(1);INSERT INTO child VALUES(1);SELECT * FROM child',
                'CREATE TEMP TABLE local(a);INSERT INTO local VALUES(1);SELECT * FROM local',
                "CREATE TABLE t(a);ALTER TABLE t ADD COLUMN label TEXT CONSTRAINT nn NOT NULL ON CONFLICT FAIL DEFAULT 'new';INSERT INTO t(a) VALUES(1);SELECT * FROM t",
                'CREATE TABLE t(a);CREATE TABLE log(v);CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT CASE WHEN NEW.a=1 THEN 2 ELSE 3 END;INSERT INTO log VALUES(NEW.a);END;INSERT INTO t VALUES(7);SELECT * FROM log',
                "CREATE VIRTUAL TABLE docs USING fts3(content);INSERT INTO docs VALUES('hello world');SELECT * FROM docs WHERE docs MATCH 'hello'",
                "CREATE VIRTUAL TABLE docs USING fts4(content);INSERT INTO docs VALUES('hello world');SELECT * FROM docs WHERE docs MATCH 'hello'",
                "CREATE VIRTUAL TABLE docs USING fts4(title,body,tokenize=porter,prefix='2,3',notindexed=title,order=DESC);INSERT INTO docs VALUES('title','running');SELECT body FROM docs WHERE docs MATCH 'run'"
            ]) positives.push({sql, result: run(sql)});
            for (const [a, b] of [
                ['CREATE TABLE t(id INTEGER PRIMARY KEY ASC);INSERT INTO t VALUES(NULL);SELECT id,rowid FROM t', 'CREATE TABLE t(id INTEGER PRIMARY KEY DESC);INSERT INTO t VALUES(NULL);SELECT id,rowid FROM t'],
                ['CREATE TABLE t(x UNIQUE ON CONFLICT IGNORE,y);INSERT INTO t VALUES(1,2),(1,3);SELECT * FROM t', 'CREATE TABLE t(x UNIQUE ON CONFLICT REPLACE,y);INSERT INTO t VALUES(1,2),(1,3);SELECT * FROM t'],
                ["CREATE VIRTUAL TABLE docs USING fts4(body,tokenize=porter);INSERT INTO docs VALUES('running');SELECT * FROM docs WHERE docs MATCH 'run'", "CREATE VIRTUAL TABLE docs USING fts4(body,tokenize=simple);INSERT INTO docs VALUES('running');SELECT * FROM docs WHERE docs MATCH 'run'"]
            ]) distinctions.push({a: run(a), b: run(b)});
            const checks = [];
            for (const value of [-1, 11]) {
                try { run('CREATE TABLE t(x CHECK(x>0) CHECK(x<10));INSERT INTO t VALUES(' + value + ')'); checks.push(false); }
                catch (_) { checks.push(true); }
            }
            return {version, positives, distinctions, checks};
        });
        assert.equal(result.version, '3.22.0'); assert.equal(result.positives.length, 11);
        for (const sample of result.positives) { assert.ok(sample.result.length, sample.sql); parse(sample.sql); }
        for (const pair of result.distinctions) assert.notDeepEqual(pair.a, pair.b);
        assert.deepEqual(result.checks, [true, true]);
        t.diagnostic('SQLite 3.22.0: 11 valid declaration scripts, 3 semantic distinctions and both CHECK constraints enforced');
    } finally { await context.close(); await browser.close(); }
});
