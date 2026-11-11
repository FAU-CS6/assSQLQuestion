/**
 * SQL-specific neighbour functions for the implicit AST graph in Graph-based QSS.
 *
 * An edit has a fixed price and applies at EVERY compatible AST position. Target
 * metadata defines finite constructor/value domains, never a positional repair
 * plan. Incomplete and non-executable states deliberately remain in the graph.
 */
import {stableKey, graphKey} from './graph-model.mjs';
import costCatalog from '../cost-catalog.json' with {type: 'json'};
import {exactInteger, comparisonComplements, boolExpression, notExpression, binaryExpression, encodedBooleanCase, decodedBooleanCase,canonicalCount,pureExpression as pure,deterministicFunction} from './sql-equivalences.mjs';
import {requirementState} from './requirements.mjs';
import {symbolFacts} from './graph-features.mjs';
import {partitionExpression,freeLabelEntries,freeDiagnosticEntries,abstractGroupLabels} from './task-equivalences.mjs';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isNode = value => Boolean(value && typeof value.kind === 'string' && value.attrs && value.slots);
const stable = stableKey;
const equal = (a, b) => stable(a) === stable(b);
const upper = name => name ? name[0].toUpperCase() + name.slice(1) : '';
const kind = (node, name) => node?.kind === name;
const binary = (operator, left = null, right = null) => ({kind: 'BinaryExpression', attrs: {operator}, slots: {left, right}});
const unary = (operator, expr = null) => ({kind: 'UnaryExpression', attrs: {operator}, slots: {expr}});

function* locations(root, path = [], parent = null, slot = null) {
    if (!isNode(root)) return;
    yield {node: root, path, parent, slot};
    for (const [name, value] of Object.entries(root.slots)) {
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; ++i) yield* locations(value[i], [...path, 'slots', name, i], root, name);
        } else yield* locations(value, [...path, 'slots', name], root, name);
    }
}
function get(root, path) { return path.reduce((value, key) => value?.[key], root); }
function replace(root, path, value) {
    if (!path.length) return value;
    const [key, ...rest] = path;
    const copy = Array.isArray(root) ? root.slice() : {...root};
    copy[key] = replace(root?.[key], rest, value);
    return copy;
}
function graphMetrics() {
    const cache = new WeakMap(), empty = {nodes:0, depth:0, listLength:0, booleanHeight:0};
    const measure = node => {
        if (!isNode(node)) return empty;
        if (cache.has(node)) return cache.get(node);
        let nodes=1, depth=1, listLength=0, height=0;
        for (const value of Object.values(node.slots)) {
            const array=Array.isArray(value);
            if(array) listLength=Math.max(listLength,value.length);
            for(const child of array?value:[value]) {
                const part=measure(child);if(!part.nodes)continue;
                // Match locations() paths: scalar edges use two path entries,
                // list edges three. Count a shared subtree at each occurrence.
                nodes+=part.nodes;depth=Math.max(depth,part.depth+(array?1.5:1));
                listLength=Math.max(listLength,part.listLength);height=Math.max(height,part.booleanHeight);
            }
        }
        const result={nodes,depth,listLength,booleanHeight:height+Number(boolean(node))};cache.set(node,result);return result;
    };
    return measure;
}
const literalKinds = new Set(['NumberLiteral', 'StringLiteral', 'NullLiteral', 'BooleanLiteral', 'BigIntLiteral', 'DoubleQuotedLiteral']);
const expressionKinds = new Set(['ColumnReference', ...literalKinds, 'BinaryExpression', 'UnaryExpression', 'AggregateExpression',
    'FunctionExpression', 'CaseExpression', 'CastExpression', 'ExpressionList', 'Subquery', 'ParameterExpression']);
const predicates = new Set(['=', '==', '!=', '<>', '<', '>', '<=', '>=', 'IS', 'IS NOT', 'AND', 'OR', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN']);
const literal = node => literalKinds.has(node?.kind) && node.kind !== 'DoubleQuotedLiteral';
function bindQuotedName(node,name){
    if(!node||['Select','Subquery','CompoundSelect'].includes(node.kind))return node;
    if(node.kind==='DoubleQuotedLiteral'&&foldIdentifier(node.attrs.value)===name
        &&Object.values(node.slots).every(v=>v==null||Array.isArray(v)&&!v.length))
        return{kind:'ColumnReference',attrs:{table:null,column:name},slots:{collate:null}};
    return{...node,slots:Object.fromEntries(Object.entries(node.slots).map(([k,v])=>[k,Array.isArray(v)?v.map(c=>bindQuotedName(c,name)):bindQuotedName(v,name)]))};
}
function boolean(node) {
    return kind(node, 'BooleanLiteral') || kind(node, 'BinaryExpression') && predicates.has(node.attrs.operator)
        || kind(node, 'UnaryExpression') && node.attrs.operator === 'NOT';
}
function containsCollation(node) {
    return [...locations(node)].some(({node: item}) => /collat|cast/i.test(item.kind)
        || Object.entries(item.attrs).some(([key, value]) => /collat/i.test(key) && value != null));
}
const plainOperator = (node, fields) => Object.entries(node.attrs).every(([name, value]) => name === 'operator' || value == null)
    && Object.entries(node.slots).every(([name, value]) => fields.includes(name) || value == null || Array.isArray(value) && !value.length);

function ancestorNodes(root, path) {
    const result = [];
    let value = root;
    if (isNode(value)) result.push(value);
    for (const part of path) {
        value = value?.[part];
        if (isNode(value)) result.push(value);
    }
    return result;
}
const foldIdentifier = value => typeof value === 'string' ? value.replace(/[A-Z]/g, letter => letter.toLowerCase()) : value;

/**
 * A column-looking expression need not be pure in SQLite: a SELECT alias can
 * expand to a volatile function, and a derived/CTE/view column can hide one.
 * Resolve provenance in the lexical SELECT scopes before granting a free law.
 * The check is deliberately conservative; it never changes the AST or SQL.
 */
function expressionContextGuard(schema) {
    const views = new Set((schema?.tables || []).filter(table => foldIdentifier(table.type) === 'view')
        .map(table => foldIdentifier(table.name)));
    const cache=new WeakMap();
    const origins=root=>{
        if(cache.has(root))return cache.get(root);
        const definitions=new Map(),opaque=new Set(views);
        for(const {node}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='VIEW'){
            const name=foldIdentifier(node.slots.view?.attrs.view);
            if(typeof name==='string'){if(!definitions.has(name))definitions.set(name,[]);definitions.get(name).push(node.slots.select);opaque.add(name);}
        }
        const safeQuery=(query,seen=new Set())=>Boolean(query)&&[...locations(query)].every(({node})=>{
            if(node.kind==='FunctionExpression'&&!deterministicFunction(node)||(node.slots.with||[]).length)return false;
            if(node.kind.startsWith('SQL:')&&typeof node.attrs.value==='string'&&/^CURRENT_(?:DATE|TIME|TIMESTAMP)$/i.test(node.attrs.value))return false;
            if(node.kind==='AggregateExpression'&&!['COUNT','SUM','AVG','MIN','MAX','TOTAL'].includes(node.attrs.name))return false;
            if(node.kind!=='TableSource'||node.slots.expr)return true;
            const name=foldIdentifier(node.attrs.table);
            if(views.has(name))return false;
            if(!definitions.has(name))return typeof name==='string';
            if(seen.has(name))return false;
            return definitions.get(name).every(q=>safeQuery(q,new Set([...seen,name])));
        });
        for(const [name,queries]of definitions)if(!views.has(name)&&queries.every(q=>safeQuery(q,new Set([name]))))opaque.delete(name);
        const sourceIsOpaque=source=>!kind(source,'TableSource')||(source.slots.expr?!safeQuery(source.slots.expr):typeof source.attrs.table!=='string'||opaque.has(foldIdentifier(source.attrs.table)));
        const value={opaque,safeQuery,sourceIsOpaque};cache.set(root,value);return value;
    };
    const safeAlias=expr=>pure(expr)||kind(expr,'AggregateExpression')&&['COUNT','SUM','AVG','MIN','MAX','TOTAL'].includes(expr.attrs.name)
        &&!expr.slots.over&&!containsCollation(expr)&&(kind(expr.slots.args?.slots.expr,'Asterisk')||pure(expr.slots.args?.slots.expr))
        ||deterministicFunction(expr)&&!expr.slots.over&&!containsCollation(expr)&&expr.slots.args?.slots.value?.length>0&&expr.slots.args.slots.value.every(safeAlias)
        ||kind(expr,'BinaryExpression')&&!containsCollation(expr)&&safeAlias(expr.slots.left)&&safeAlias(expr.slots.right)
        ||kind(expr,'UnaryExpression')&&['NOT','+','-','~'].includes(expr.attrs.operator)&&safeAlias(expr.slots.expr);
    const guard=(expression, root, path) => {
        const {opaque,sourceIsOpaque}=origins(root);
        const references = [...locations(expression)].filter(({node}) => kind(node, 'ColumnReference')).map(({node}) => node);
        if (!references.length) return true;
        const ancestors = ancestorNodes(root, path), scopes = ancestors.filter(node => kind(node, 'Select'));
        if (ancestors.some(node => (node.slots.with || []).length > 0)) return false;
        if (!scopes.length) {
            // CHECK and other base-column expressions do not acquire a SELECT
            // alias context. Still reject a command involving a known view.
            const command = ancestors.find(node => node.kind !== 'Script') || expression;
            return ![...locations(command)].some(({node}) => kind(node, 'TableSource')
                && opaque.has(foldIdentifier(node.attrs.table)))
                && !references.some(node => node.attrs.table != null && opaque.has(foldIdentifier(node.attrs.table)));
        }
        for (const reference of references) {
            const qualifier = reference.attrs.table;
            if (qualifier == null) {
                // SQLite can expand SELECT aliases in WHERE and ON, including
                // correlated scopes. Only a matching alias matters: an unrelated
                // function in the SELECT list does not make base columns impure.
                for (const scope of scopes) {
                    if ((scope.slots.columns || []).some(item => item?.attrs?.as != null
                        && foldIdentifier(item.attrs.as) === foldIdentifier(reference.attrs.column)
                        && !safeAlias(item.slots.expr))) return false;
                    if ((scope.slots.from || []).some(sourceIsOpaque)) return false;
                }
            } else {
                let resolved = false;
                for (let i = scopes.length - 1; i >= 0; --i) {
                    const sources = (scopes[i].slots.from || []).filter(source =>
                        foldIdentifier(source?.attrs?.as ?? source?.attrs?.table) === foldIdentifier(qualifier));
                    if (!sources.length) continue;
                    if (sources.length !== 1 || sourceIsOpaque(sources[0])) return false;
                    resolved = true;
                    break;
                }
                if (!resolved) return false;
            }
        }
        return true;
    };
    guard.querySafe=(query,root)=>origins(root).safeQuery(query);
    return guard;
}

/** Exported for focused graph/trace verification, not a distance approximation. */
export function replayOperation(root, operation) {
    const before = get(root, operation.path);
    if (!equal(before, operation.before)) throw new Error('Edit replay does not match its starting AST.');
    return replace(root, operation.path, operation.after);
}

export function createEditGraph(reference, answer, schema = {}, costOverrides = {}, requirements = {}) {
    if (!isNode(reference) || !isNode(answer)) throw new TypeError('Graph-QSS requires semantic AST nodes.');
    const stable = graphKey(), equal = (a, b) => stable(a) === stable(b);
    const measure = graphMetrics(), startStats = measure(answer), targetStats = measure(reference);
    const contextSafe = expressionContextGuard(schema);
    const constrained=Boolean(requirements.forbidden?.length||requirements.required?.length);
    // Structural model bounds (§4.6.2), not an execution-time or visited-node budget.
    // Leave room for reverse equivalences and temporary incomplete constructors.
    const limits = {
        maxNodes: Math.max(12, startStats.nodes + targetStats.nodes + 4),
        maxDepth: Math.max(8, Math.max(startStats.depth, targetStats.depth) + 2),
        maxListLength: Math.max(4, Math.max(startStats.listLength, targetStats.listLength) + 1),
        maxBooleanHeight: Math.max(startStats.booleanHeight, targetStats.booleanHeight) + 1
    };
    const bounded = root => {
        const size = measure(root);
        return size.nodes <= limits.maxNodes && size.depth <= limits.maxDepth && size.listLength <= limits.maxListLength
            && size.booleanHeight <= limits.maxBooleanHeight;
    };
    const attrs = new Map(), grammar = new Map(), shapes = new Map(), shapeVariants = new Map(), variants = new Map(), aliases = new Set();
    const attrDomain = (name, field) => {
        const key = name + '.' + field;
        if (!attrs.has(key)) attrs.set(key, {kind: name, field, values: new Map()});
        return attrs.get(key);
    };
    const addValue = (name, field, value) => attrDomain(name, field).values.set(stable(value), value);
    const addGrammar = (name, field, array, childKinds = []) => {
        const key = name + '.' + field;
        if (!grammar.has(key)) grammar.set(key, {kind: name, field, array, children: new Set()});
        const rule = grammar.get(key);
        for (const child of childKinds) rule.children.add(child);
        if (!shapes.has(name)) shapes.set(name, {});
        shapes.get(name)[field] = array;
        return rule;
    };
    for (const root of [reference, answer]) for (const {node} of locations(root)) {
        if (!shapes.has(node.kind)) shapes.set(node.kind, {});
        if (!shapeVariants.has(node.kind)) shapeVariants.set(node.kind, new Map());
        const nodeShape = Object.fromEntries(Object.entries(node.slots).map(([field, value]) => [field, Array.isArray(value)]));
        shapeVariants.get(node.kind).set(stable(nodeShape), nodeShape);
        if (!variants.has(node.kind)) variants.set(node.kind, new Map());
        variants.get(node.kind).set(stable(node.attrs), node.attrs);
        for (const [field, value] of Object.entries(node.attrs)) {
            addValue(node.kind, field, value);
            if ((field === 'as' || field === 'table') && typeof value === 'string') aliases.add(value);
        }
        for (const [field, value] of Object.entries(node.slots)) {
            addGrammar(node.kind, field, Array.isArray(value), (Array.isArray(value) ? value : [value]).filter(isNode).map(child => child.kind));
        }
    }
    // SQL constructors/slots, independent of where the target happens to use them.
    const sqlExpressions = [...expressionKinds].filter(name => shapes.has(name)
        || ['ColumnReference', 'NumberLiteral', 'BinaryExpression', 'UnaryExpression', 'AggregateExpression'].includes(name));
    addGrammar('Script', 'statements', true, [...shapes.keys()].filter(name => /^(Select|Insert|Update|Delete|Create|Alter|Drop|Pragma|With|Transaction|Statement)$/.test(name)));
    addGrammar('Select', 'columns', true, ['SelectItem']);
    addGrammar('Select', 'from', true, ['TableSource']);
    addGrammar('Select', 'where', false, sqlExpressions);
    addGrammar('Select', 'having', false, sqlExpressions);
    addGrammar('SelectItem', 'expr', false, sqlExpressions);
    addGrammar('OrderByItem', 'expr', false, sqlExpressions);
    addGrammar('TableSource', 'on', false, sqlExpressions);
    addGrammar('BinaryExpression', 'left', false, sqlExpressions);
    addGrammar('BinaryExpression', 'right', false, sqlExpressions);
    addGrammar('UnaryExpression', 'expr', false, sqlExpressions);
    addGrammar('AggregateExpression', 'args', false, ['AggregateArguments']);
    addGrammar('AggregateArguments', 'expr', false, sqlExpressions);
    // Every SQL expression position supports the finite family, not only its
    // initial child type. This permits intermediate expression constructors.
    const expressionRole = rule => ['expr', 'left', 'right', 'where', 'having', 'on', 'condition', 'then', 'else', 'elseValue'].includes(rule.field)
        || rule.kind === 'GroupBy' && rule.field === 'columns';
    for (const rule of grammar.values()) if (expressionRole(rule) && [...rule.children].some(name => expressionKinds.has(name))) {
        for (const name of sqlExpressions) rule.children.add(name);
    }
    addValue('UnaryExpression', 'operator', 'NOT');
    // The paid outer-JOIN relocation uses SQL's literal true condition 1=1.
    addValue('NumberLiteral', 'value', '1');
    addValue('NumberLiteral', 'storageClass', 'integer');
    for (const operator of ['AND', 'OR', '=', '!=', '<>', '<', '>', '<=', '>=']) addValue('BinaryExpression', 'operator', operator);
    for (const table of schema?.tables || []) {
        if (typeof table.name !== 'string') continue;
        addValue('TableSource', 'table', table.name);
        addValue('ColumnReference', 'table', table.name);
        aliases.add(table.name);
        for (const column of table.columns || []) if (typeof column.name === 'string') addValue('ColumnReference', 'column', column.name);
    }
    for (const name of aliases) addValue('ColumnReference', 'table', name);
    aliases.add('__qss_alias');
    const defaults = {
        Select: {distinct: false}, AggregateArguments: {distinct: false},
        ColumnReference: {column: null, table: null, db: null},
        TableSource: {table: null, as: null, db: null, join: null}
    };
    const shallow = (name, shape = shapes.get(name) || {}) => ({kind: name, attrs: {...(defaults[name] || {})}, slots: Object.fromEntries(Object.entries(shape).map(([field, array]) => [field, array ? [] : null]))});
    const constructors = name => {
        // Optional grammar fields may be absent rather than null in native
        // parser extensions. Retain every observed *shallow* shape so arbitrary
        // source/target states remain connected via the empty AST.
        const bases = [shallow(name), ...[...(shapeVariants.get(name)?.values() || [])].map(shape => shallow(name, shape))];
        const values = [];
        for (const empty of bases) {
            values.push(empty);
            const seed = (field, value) => values.push({...empty, attrs: {...empty.attrs, [field]: value}});
            if (literalKinds.has(name) || name === 'ColumnReference' || name === 'TableSource') {
                // Intrinsic leaf constructors match the original addLiteral / addColumnReference.
                for (const intrinsic of variants.get(name)?.values() || []) values.push({...empty, attrs: {...intrinsic}});
                if (name === 'NumberLiteral') values.push({...empty, attrs: {value: '1', storageClass: 'integer'}});
                if (name === 'ColumnReference') for (const column of attrs.get(name + '.column')?.values.values() || []) {
                    for (const table of attrs.get(name + '.table')?.values.values() || [null]) values.push({...empty, attrs: {column, table, db: null}});
                }
            } else if (name === 'BinaryExpression' || name === 'UnaryExpression') {
                for (const value of attrs.get(name + '.operator')?.values.values() || []) seed('operator', value);
            } else if (name === 'AggregateExpression') {
                for (const value of attrs.get(name + '.name')?.values.values() || []) {
                    values.push({...empty, attrs: {...empty.attrs, name: value}, slots: {...empty.slots, args: shallow('AggregateArguments')}});
                }
            }
        }
        return [...new Map(values.map(value => [stable(value), value])).values()];
    };
    const edits = [], names = new Set();
    const register = (name, description, defaultCost, generate,
        {maxNewSymbols = 1, maxNewDistinct = 0, statementOperation = null, statementKind = null,
            introducedComponent = null, preservesSymbolSet = false, maxNewRelations = 0, maxNewSources = 0,componentWorkBounded=true,costGroup=null} = {}) => {
        if (names.has(name)) return;
        names.add(name);
        const cost = own(costOverrides || {}, name) ? costOverrides[name]
            : costGroup && own(costOverrides || {}, costGroup) ? costOverrides[costGroup] : defaultCost;
        if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Edit costs must be nonnegative safe integers: ' + name);
        // Predicate guidance is a binary missing-fact bound, not a count:
        // one paid binding/attribute edit may introduce many contextual facts.
        // Only the proved semantic equivalences preserve the complete fact set.
        const maxNewPredicates = defaultCost === 0 ? 0 : 1;
        edits.push({name, description, cost, maxNewSymbols, maxNewPredicates, maxNewDistinct,
            statementOperation, statementKind, introducedComponent, preservesSymbolSet, maxNewRelations, maxNewSources,componentWorkBounded,
            *apply(root) {
                const emitted = new Set();
                for (const change of generate(root)) {
                    const next = replace(root, change.path, change.after);
                    if (equal(root, next) || !bounded(next)) continue;
                    if(cost===0&&constrained&&requirementState(root,requirements)!==requirementState(next,requirements))continue;
                    const key = stable(next);
                    if (emitted.has(key)) continue;
                    emitted.add(key);
                    yield {root: next, operation: {type: 'sql-edit', name, cost, path: change.path, before: get(root, change.path), after: change.after}};
                }
            }});
    };
    for (const rule of grammar.values()) for (const childKind of rule.children) {
        const suffix = rule.kind + upper(rule.field) + childKind;
        const templates = constructors(childKind);
        const price = rule.kind === 'Script' && rule.field === 'statements' || childKind==='TableSource' ? 5 : /Distinct/i.test(childKind) ? 2 : 1;
        register('add' + suffix, 'Add a ' + childKind + ' in SQL ' + rule.kind + '.' + rule.field, price, function* (root) {
            for (const {node, path} of locations(root)) if (node.kind === rule.kind) {
                const current = node.slots[rule.field], at = [...path, 'slots', rule.field];
                if (rule.array) {
                    if (current != null && !Array.isArray(current)) continue;
                    const list = current || [];
                    for (let i = 0; i <= list.length; ++i) for (const template of templates) yield {path: at, after: [...list.slice(0, i), template, ...list.slice(i)]};
                } else if (current == null) for (const template of templates) yield {path: at, after: template};
            }
        }, {maxNewSymbols: literalKinds.has(childKind) || ['ColumnReference', 'TableSource', 'AggregateExpression'].includes(childKind) ? 1 : 0,
            costGroup:'baseAdd'+(price===5?'Structural':price===2?'Distinct':'Component'),
            statementOperation: rule.kind === 'Script' && rule.field === 'statements' ? 'add' : null, statementKind: childKind,
            introducedComponent: childKind, maxNewRelations: childKind==='TableSource'?1:0, maxNewSources:childKind==='TableSource'?1:0});
        register('remove' + suffix, 'Remove a ' + childKind + ' from SQL ' + rule.kind + '.' + rule.field, price, function* (root) {
            for (const {node, path} of locations(root)) if (node.kind === rule.kind) {
                const current = node.slots[rule.field], at = [...path, 'slots', rule.field];
                if (Array.isArray(current)) {
                    for (let i = 0; i < current.length; ++i) if (kind(current[i], childKind)) yield {path: at, after: [...current.slice(0, i), ...current.slice(i + 1)]};
                } else if (kind(current, childKind)) yield {path: at, after: null};
            }
        }, {maxNewSymbols: 0, costGroup:'baseRemove'+(price===5?'Structural':price===2?'Distinct':'Component'), statementOperation: rule.kind === 'Script' && rule.field === 'statements' ? 'remove' : null, statementKind: childKind});
    }
    for (const {kind: nodeKind, field, values} of attrs.values()) {
        const suffix = nodeKind + upper(field), price = nodeKind==='TableSource'&&field==='table'?5:/distinct/i.test(field)?2:1;
        for (const action of ['set', 'change', 'unset']) register(action + suffix, action + ' SQL ' + nodeKind + '.' + field, price, function* (root) {
            for (const {node, path} of locations(root)) if (node.kind === nodeKind) {
                const present = own(node.attrs, field), current = node.attrs[field];
                if (action === 'unset') {
                    if (present) {
                        const after = {...node.attrs}; delete after[field];
                        yield {path: [...path, 'attrs'], after};
                    }
                } else if (action === 'set' ? !present || current == null : present && current != null) {
                    for (const value of values.values()) if (!present || !equal(value, current)) yield {path: [...path, 'attrs'], after: {...node.attrs, [field]: value}};
                }
            }
        }, {costGroup:'base'+action[0].toUpperCase()+action.slice(1)+(price===5?'Structural':price===2?'Distinct':'Component'),maxNewSymbols: nodeKind==='NumberLiteral'&&field==='storageClass'?1:action !== 'unset' && (literalKinds.has(nodeKind) && field === 'value'
            || nodeKind === 'ColumnReference' && field === 'column'
            || nodeKind === 'TableSource' && field === 'table'
            || nodeKind === 'AggregateExpression' && field === 'name') ? 1 : 0,
            maxNewDistinct: nodeKind === 'Select' && field === 'distinct' && action !== 'unset' ? 1 : 0,
            maxNewRelations:nodeKind==='TableSource'&&field==='table'&&action!=='unset'?1:0});
    }

    const expressionChange = (name, description, cost, transform, annotations) => register(name, description, cost, function* (root) {
        for (const {node, path, parent, slot} of locations(root)) {
            let contextAllowed = null;
            for (const after of transform(node, root, path) || []) {
                // Most AST positions cannot use this edit. Defer the scope walk
                // until a free candidate actually exists; never weaken its guard.
                if (cost === 0 && contextAllowed === null) contextAllowed = contextSafe(node, root, path);
                if (contextAllowed === false) break;
                if (parent && !grammar.get(parent.kind + '.' + slot)?.children.has(after.kind)) continue;
                yield {path, after};
            }
        }
    }, annotations);
    const zero = {maxNewSymbols: 0, preservesSymbolSet: true};
    const freeLabels=requirements.freeLabels||[];
    if(freeLabels.length){
        const labels=new Map();
        for(const input of [reference,answer])for(const {item}of freeLabelEntries(input,freeLabels)){
            const decoded=partitionExpression(item.slots.expr);if(decoded&&!decoded.identity)labels.set(stable(item.slots.expr),decoded);
        }
        register('relabelUnconstrainedBooleanGroups','Choose distinct Boolean-group labels explicitly left free by the question',0,function*(root){
            for(const {item,path}of freeLabelEntries(root,freeLabels)){
                const expr=item.slots.expr;if(!contextSafe(expr,root,path))continue;
                const decoded=partitionExpression(expr);
                if(decoded&&!decoded.identity)yield{path,after:decoded.predicate};
                else if(boolExpression(expr)&&pure(expr)){
                    yield{path,after:expr.kind==='UnaryExpression'&&expr.attrs.operator==='NOT'&&boolExpression(expr.slots.expr)?expr.slots.expr:notExpression(expr)};
                    for(const label of labels.values())yield{path,after:label.build(expr)};
                }
            }
        },zero);
        if(requirements.freeDiagnostics){
            const tuples=new Map();for(const input of [reference,answer])for(const {columns}of freeDiagnosticEntries(input,freeLabels))tuples.set(stable(columns.map(c=>c.slots.expr)),columns.map(c=>c.slots.expr));
            register('chooseUnconstrainedDiagnosticTuple','Choose the question-permitted constant feedback tuple after a verified result-row count',0,function*(root){
                for(const {columns,path}of freeDiagnosticEntries(root,freeLabels))for(const tuple of tuples.values())if(tuple.length===columns.length)
                    yield{path,after:columns.map((c,i)=>({...c,slots:{...c.slots,expr:tuple[i]}}))};
            },zero);
        }
    }
    register('repairDeclaredColumnBinding','Repair a column declaration and bind matching SQLite quoted CHECK names',1,function*(root){
        for(const {node,path}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='TABLE'||node.kind==='Alter'&&Array.isArray(node.slots.expr)){
            const field=node.kind==='Alter'?'expr':'create_definitions',defs=node.slots[field]||[];
            for(let i=0;i<defs.length;i++)if(defs[i].attrs.resource==='COLUMN'&&defs[i].slots.column?.kind==='ColumnReference'
                &&(node.kind!=='Alter'||defs[i].attrs.action==='ADD'))
                for(const name of attrs.get('ColumnReference.column')?.values.values()||[]){
                    if(typeof name!=='string'||name==='*'||name===defs[i].slots.column.attrs.column)continue;
                    const after=defs.map((d,j)=>{
                        const n={...d,slots:{...d.slots}};
                        if(i===j)n.slots.column={...d.slots.column,attrs:{...d.slots.column.attrs,column:name}};
                        if(n.slots.check)n.slots.check=bindQuotedName(n.slots.check,name);
                        return n;
                    });
                    yield{path:[...path,'slots',field],after};
                }
        }
    },{maxNewSymbols:1});
    const projections=new Map();
    for(const input of [reference,answer])for(const {node}of locations(input))
        if(node.kind==='SelectItem'&&node.slots.expr
            &&![...locations(node)].some(({node:n})=>['Select','CompoundSelect','Subquery','TableSource','Definition','OrderByItem'].includes(n.kind)))
            projections.set(stable(node),node);
    if(projections.size)register('insertProjectedExpression','Insert one non-query projected SQL expression',1,function*(root){
        for(const {node,path}of locations(root))if(node.kind==='Select'){
            const list=node.slots.columns||[];
            for(const value of projections.values())for(let i=0;i<=list.length;i++){
                const slots={...node.slots,columns:[...list.slice(0,i),value,...list.slice(i)]};
                if(typeof value.attrs.as==='string')for(const field of ['where','having','groupby','orderby','from']){
                    const v=slots[field],name=foldIdentifier(value.attrs.as);slots[field]=Array.isArray(v)?v.map(c=>bindQuotedName(c,name)):bindQuotedName(v,name);
                }
                yield{path,after:{...node,slots}};
            }
        }
    },{maxNewSymbols:Math.max(0,...[...projections.values()].map(n=>symbolFacts(n).size+4)),introducedComponent:'SelectItem',
        componentWorkBounded:![...projections.values()].some(n=>[...locations(n)].some(({node})=>node.kind==='DataType'))});
    // Restore one declarative column constraint as one logical repair. A foreign
    // key target is not the data source of the entire submitted SQL operation.
    for(const field of ['reference_definition','nullable']){
        const values=new Map();
        for(const input of [reference,answer])for(const {node}of locations(input))
            if((node.kind==='Definition'||node.kind==='Alter'&&node.attrs.action==='ADD')&&node.attrs.resource==='COLUMN'&&node.slots[field])values.set(stable(node.slots[field]),node.slots[field]);
        if(!values.size)continue;
        const bound=Math.max(0,...[...values.values()].map(n=>symbolFacts(n).size));
        register('repairColumn'+upper(field),'Repair one SQL column constraint',1,function*(root){
            for(const {node,path}of locations(root))if((node.kind==='Definition'||node.kind==='Alter'&&node.attrs.action==='ADD')&&node.attrs.resource==='COLUMN')
                for(const value of values.values())yield{path:[...path,'slots',field],after:value};
        },{maxNewSymbols:bound});
    }
    const tableConstraints=new Map();
    for(const input of [reference,answer])for(const {node}of locations(input))
        if(node.kind==='Definition'&&node.attrs.resource==='CONSTRAINT'
            &&['FOREIGN KEY','PRIMARY KEY','UNIQUE'].includes(node.attrs.constraint_type)
            &&![...locations(node)].some(({node:n})=>['Select','CompoundSelect','Subquery'].includes(n.kind)))tableConstraints.set(stable(node),node);
    if(tableConstraints.size)register('restoreTableConstraint','Restore one declared table constraint',1,function*(root){
        for(const {node,path}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='TABLE')
            for(const value of tableConstraints.values())for(let i=0;i<=(node.slots.create_definitions||[]).length;i++)
                yield{path:[...path,'slots','create_definitions'],after:[...(node.slots.create_definitions||[]).slice(0,i),value,...(node.slots.create_definitions||[]).slice(i)]};
    },{maxNewSymbols:Math.max(0,...[...tableConstraints.values()].map(n=>symbolFacts(n).size)),introducedComponent:'Definition'});
    register('relocateSingleColumnForeignKey','Move an unnamed single-column foreign key between column and table syntax',0,function*(root){
        for(const {node,path}of locations(root))if(node.kind==='Create'&&node.attrs.keyword==='TABLE'){
            const defs=node.slots.create_definitions||[];
            for(let i=0;i<defs.length;i++){
                const d=defs[i];
                if(d.kind!=='Definition')continue;
                if(d.attrs.resource==='COLUMN'&&d.slots.reference_definition&&!d.attrs.constraint
                    &&!defs.slice(i+1).some(v=>v.slots.reference_definition)){
                    const column={...d,slots:{...d.slots}};delete column.slots.reference_definition;
                    const fk={kind:'Definition',attrs:{constraint:null,constraint_type:'FOREIGN KEY',keyword:null,index:null,resource:'CONSTRAINT'},
                        slots:{definition:[d.slots.column],reference_definition:d.slots.reference_definition}};
                    yield{path:[...path,'slots','create_definitions'],after:defs.map((v,j)=>j===i?column:v).concat(fk)};
                }
                if(d.attrs.resource!=='CONSTRAINT'||d.attrs.constraint_type!=='FOREIGN KEY'||d.attrs.constraint
                    ||Object.entries(d.attrs).some(([k,v])=>!['resource','constraint_type','constraint','keyword','index'].includes(k)&&v!=null)
                    ||d.slots.definition?.length!==1||!d.slots.reference_definition)continue;
                const j=defs.findIndex(v=>v.kind==='Definition'&&v.attrs.resource==='COLUMN'&&!v.slots.reference_definition&&equal(v.slots.column,d.slots.definition[0]));
                if(j<0||defs.slice(j+1,i).some(v=>v.slots.reference_definition))continue;
                yield{path:[...path,'slots','create_definitions'],after:defs.map((v,k)=>k===j?{...v,slots:{...v.slots,reference_definition:d.slots.reference_definition}}:v).filter((v,k)=>k!==i)};
            }
        }
    },{...zero,introducedComponent:'Definition'});
    const constantTemplates = new Map();
    for (const input of [reference,answer]) for (const {node} of locations(input)) {
        const value=exactInteger(node);if(value===null)continue;
        const key=String(value);if(!constantTemplates.has(key))constantTemplates.set(key,new Map());
        constantTemplates.get(key).set(stable(node),node);
    }
    const namedProjectionContext = (root,path) => {
        const ancestors=ancestorNodes(root,path);
        const projection=ancestors.findLast(n=>n.kind==='SelectItem');
        return !projection || projection.attrs.as != null;
    };
    expressionChange('rewriteExactIntegerConstant','Rewrite an exactly equal int64 constant expression',0,(node,root,path)=>{
        if(!namedProjectionContext(root,path))return[];
        const value=exactInteger(node);return value===null?[]:[...(constantTemplates.get(String(value))?.values()||[])];
    },zero);
    expressionChange('negateComplementaryComparison','Express a comparison by negating its complement',0,node=>{
        if(node.kind==='BinaryExpression'&&comparisonComplements[node.attrs.operator]&&pure(node)
            &&plainOperator(node,['left','right']))return[notExpression({...node,attrs:{...node.attrs,operator:comparisonComplements[node.attrs.operator]}})];
        if(node.kind==='UnaryExpression'&&node.attrs.operator==='NOT'&&node.slots.expr?.kind==='BinaryExpression'
            &&comparisonComplements[node.slots.expr.attrs.operator]&&pure(node.slots.expr)
            &&plainOperator(node,['expr'])&&plainOperator(node.slots.expr,['left','right']))
            return[{...node.slots.expr,attrs:{...node.slots.expr.attrs,operator:comparisonComplements[node.slots.expr.attrs.operator]}}];
        return[];
    },zero);
    expressionChange('deMorganBoolean','Apply three-valued De Morgan laws to Boolean predicates',0,node=>{
        if(node.kind==='BinaryExpression'&&['AND','OR'].includes(node.attrs.operator)&&pure(node)
            &&boolExpression(node.slots.left)&&boolExpression(node.slots.right)&&plainOperator(node,['left','right']))
            return[notExpression(binaryExpression(node.attrs.operator==='AND'?'OR':'AND',notExpression(node.slots.left),notExpression(node.slots.right)))];
        if(node.kind==='UnaryExpression'&&node.attrs.operator==='NOT'&&plainOperator(node,['expr'])){
            const child=node.slots.expr;
            if(child?.kind==='BinaryExpression'&&['AND','OR'].includes(child.attrs.operator)&&pure(child)
                &&plainOperator(child,['left','right'])
                &&child.slots.left?.kind==='UnaryExpression'&&child.slots.left.attrs.operator==='NOT'
                &&child.slots.right?.kind==='UnaryExpression'&&child.slots.right.attrs.operator==='NOT'
                &&plainOperator(child.slots.left,['expr'])&&plainOperator(child.slots.right,['expr'])
                &&boolExpression(child.slots.left.slots.expr)&&boolExpression(child.slots.right.slots.expr))
                return[binaryExpression(child.attrs.operator==='AND'?'OR':'AND',child.slots.left.slots.expr,child.slots.right.slots.expr)];
        }return[];
    },zero);
    expressionChange('booleanCaseEncoding','Encode a Boolean value as a NULL-preserving CASE expression',0,(node,root,path)=>{
        const parents=ancestorNodes(root,path);
        const projection=parents.at(-2);
        if(projection?.kind!=='SelectItem'||projection.attrs.as==null)return[];
        const decoded=decodedBooleanCase(node);
        if(decoded&&pure(decoded))return[decoded];
        return boolExpression(node)&&pure(node)?[encodedBooleanCase(node)]:[];
    },zero);
    expressionChange('countStarOne','Count rows using either star or the non-NULL integer one',0,(node,root,path)=>{
        if(!namedProjectionContext(root,path)||!canonicalCount(node))return[];
        const expr=node.slots.args.slots.expr?.kind==='Asterisk'
            ?{kind:'NumberLiteral',attrs:{value:'1',storageClass:'integer'},slots:{}}
            :{kind:'Asterisk',attrs:{value:'*'},slots:{}};
        return[{...node,slots:{...node.slots,args:{...node.slots.args,slots:{...node.slots.args.slots,expr}}}}];
    },zero);
    expressionChange('changeLiteral', 'Change a SQL literal, retaining its intrinsic SQLite storage class', 1, node => {
        if (!literalKinds.has(node.kind)) return [];
        return [...literalKinds].flatMap(name => [...(variants.get(name)?.values() || [])].map(intrinsic => ({...shallow(name), attrs: {...intrinsic}})));
    }, {maxNewSymbols: 1});
    expressionChange('changeColumnReference', 'Change the column and its table qualifier together', 1, node => {
        if (!kind(node, 'ColumnReference')) return [];
        return constructors('ColumnReference').filter(candidate => candidate.attrs.column != null);
    });
    expressionChange('changeAggregateType', 'Change a SQL aggregate function while retaining its argument', 1, node => {
        if (!kind(node, 'AggregateExpression')) return [];
        return [...(attrs.get('AggregateExpression.name')?.values.values() || [])].map(name => ({...node, attrs: {...node.attrs, name}}));
    }, {maxNewSymbols: 1});
    expressionChange('commuteBooleanOperands', 'Swap pure AND/OR operands', 0, node => {
        if (kind(node, 'BinaryExpression') && ['AND', 'OR'].includes(node.attrs.operator)
            && pure(node.slots.left) && pure(node.slots.right)) return [{...node, slots: {...node.slots, left: node.slots.right, right: node.slots.left}}];
        return [];
    }, zero);
    expressionChange('associateBooleanOperands', 'Reassociate pure AND/OR operands', 0, node => {
        if (!kind(node, 'BinaryExpression') || !['AND', 'OR'].includes(node.attrs.operator) || !pure(node) || !plainOperator(node, ['left', 'right'])) return [];
        const op = node.attrs.operator, a = node.slots.left, b = node.slots.right, result = [];
        if (kind(a, 'BinaryExpression') && a.attrs.operator === op && plainOperator(a, ['left', 'right'])) result.push(binary(op, a.slots.left, binary(op, a.slots.right, b)));
        if (kind(b, 'BinaryExpression') && b.attrs.operator === op && plainOperator(b, ['left', 'right'])) result.push(binary(op, binary(op, a, b.slots.left), b.slots.right));
        return result;
    }, zero);
    expressionChange('duplicateBooleanPredicate', 'Duplicate a pure Boolean predicate (reverse idempotence)', 0, node => {
        if (!boolean(node) || !pure(node)) return [];
        return [binary('AND', node, node), binary('OR', node, node)];
    }, zero);
    expressionChange('collapseDuplicateBooleanPredicate', 'Collapse repeated pure Boolean predicate', 0, node => {
        if (kind(node, 'BinaryExpression') && ['AND', 'OR'].includes(node.attrs.operator) && boolean(node.slots.left)
            && plainOperator(node, ['left', 'right']) && pure(node.slots.left) && equal(node.slots.left, node.slots.right)) return [node.slots.left];
        return [];
    }, zero);
    expressionChange('rewriteNotEqual', 'Rewrite != or <> as negated equality, and conversely', 0, node => {
        if (kind(node, 'BinaryExpression') && ['!=', '<>'].includes(node.attrs.operator) && pure(node)) return [unary('NOT', {...node, attrs: {...node.attrs, operator: '='}})];
        if (kind(node, 'UnaryExpression') && node.attrs.operator === 'NOT' && kind(node.slots.expr, 'BinaryExpression')
            && plainOperator(node, ['expr']) && node.slots.expr.attrs.operator === '=' && pure(node.slots.expr)) return ['!=', '<>'].map(operator => ({...node.slots.expr, attrs: {...node.slots.expr.attrs, operator}}));
        return [];
    }, zero);
    expressionChange('mirrorColumnLiteralComparison', 'Mirror a plain SQLite column/literal comparison', 0, node => {
        const mirrors = {'=': '=', '==': '==', '!=': '!=', '<>': '<>', '<': '>', '>': '<', '<=': '>=', '>=': '<='};
        if (!kind(node, 'BinaryExpression') || !own(mirrors, node.attrs.operator) || containsCollation(node)) return [];
        const left = node.slots.left, right = node.slots.right;
        if (!(kind(left, 'ColumnReference') && literal(right) || literal(left) && kind(right, 'ColumnReference'))) return [];
        return [{...node, attrs: {...node.attrs, operator: mirrors[node.attrs.operator]}, slots: {...node.slots, left: right, right: left}}];
    }, zero);
    expressionChange('mirrorComparisonOperands', 'Reverse a SQL comparison, charging for possible collation or affinity changes', 1, node => {
        const mirrors = {'=': '=', '==': '==', '!=': '!=', '<>': '<>', '<': '>', '>': '<', '<=': '>=', '>=': '<='};
        if (!kind(node, 'BinaryExpression') || !own(mirrors, node.attrs.operator)) return [];
        return [{...node, attrs: {...node.attrs, operator: mirrors[node.attrs.operator]},
            slots: {...node.slots, left: node.slots.right, right: node.slots.left}}];
    }, {maxNewSymbols: 0});
    expressionChange('swapBinaryOperands', 'Swap the operands of a binary SQL operation', 1, node => {
        if (!kind(node, 'BinaryExpression') || !node.slots.left || !node.slots.right) return [];
        return [{...node, slots: {...node.slots, left: node.slots.right, right: node.slots.left}}];
    }, {maxNewSymbols: 0});
    expressionChange('reassociateBinaryOperands', 'Change grouping of two binary SQL operations, charging for changed semantics', 1, node => {
        if (!kind(node, 'BinaryExpression')) return [];
        const left = node.slots.left, right = node.slots.right, result = [];
        if (kind(left, 'BinaryExpression')) {
            result.push({...left, slots: {...left.slots, left: left.slots.left,
                right: {...node, slots: {...node.slots, left: left.slots.right, right}}}});
        }
        if (kind(right, 'BinaryExpression')) {
            result.push({...right, slots: {...right.slots,
                left: {...node, slots: {...node.slots, left, right: right.slots.left}}, right: right.slots.right}});
        }
        return result;
    }, {maxNewSymbols: 0});
    // SQL-expression shortcuts preserve the existing expression rather than
    // inserting a complete target subtree in one step.
    expressionChange('wrapUnaryExpression', 'Wrap an expression in a unary SQL operator', 1, node => {
        if (!expressionKinds.has(node.kind)) return [];
        return [...(attrs.get('UnaryExpression.operator')?.values.values() || [])].map(operator => unary(operator, node));
    }, {maxNewSymbols: 0});
    expressionChange('unwrapUnaryExpression', 'Remove a unary SQL operator', 1, node => kind(node, 'UnaryExpression') && node.slots.expr ? [node.slots.expr] : [], {maxNewSymbols: 0});
    expressionChange('wrapBinaryExpression', 'Add a binary SQL expression around an existing operand', 1, node => {
        if (!expressionKinds.has(node.kind)) return [];
        const result = [];
        for (const operator of attrs.get('BinaryExpression.operator')?.values.values() || []) result.push(binary(operator, node, null), binary(operator, null, node));
        return result;
    }, {maxNewSymbols: 0});
    expressionChange('unwrapIncompleteBinaryExpression', 'Remove a binary operator with a missing operand', 1, node => {
        if (!kind(node, 'BinaryExpression') || node.slots.left && node.slots.right) return [];
        return [node.slots.left || node.slots.right].filter(Boolean);
    }, {maxNewSymbols: 0});
    expressionChange('removeExtraneousBinaryTerm', 'Remove an extraneous binary SQL operation and retain one operand', 1, node => {
        if (!kind(node, 'BinaryExpression')) return [];
        return [node.slots.left, node.slots.right].filter(Boolean);
    }, {maxNewSymbols: 0});
    expressionChange('wrapAggregateExpression', 'Add a SQL aggregate around an expression', 1, node => {
        if (!expressionKinds.has(node.kind)) return [];
        return [...(attrs.get('AggregateExpression.name')?.values.values() || [])].map(name => ({kind: 'AggregateExpression', attrs: {name},
            slots: {args: {kind: 'AggregateArguments', attrs: {distinct: false}, slots: {expr: node}}}}));
    }, {maxNewSymbols: 1});
    expressionChange('unwrapAggregateExpression', 'Remove a SQL aggregate while retaining its argument', 1, node => {
        if (kind(node, 'AggregateExpression') && isNode(node.slots.args?.slots?.expr)) return [node.slots.args.slots.expr];
        return [];
    }, {maxNewSymbols: 0});

    // Alias/INNER-JOIN edges are installed below as schema/scope-aware edits.
    registerAliasEdits(register, aliases, zero);
    registerJoinEdits(register, zero, contextSafe);
    registerOuterJoinEdits(register);
    // Persisted profiles include known steps that need not occur in this pair.
    // Keep the existing pair-specific API for individual atomic edit IDs too.
    const configuredNames=new Set(costCatalog.steps.map(step=>step.id));
    for (const [key,value] of Object.entries(costOverrides || {})) {
        if (!names.has(key) && !configuredNames.has(key)) throw new TypeError('Unknown SQL edit: ' + key);
        if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Edit costs must be nonnegative safe integers: ' + key);
    }
    const abstractCache=new WeakMap();
    const abstractRoot=root=>{if(!freeLabels.length)return root;if(!abstractCache.has(root))abstractCache.set(root,abstractGroupLabels(root,freeLabels,requirements.freeDiagnostics));return abstractCache.get(root);};
    return {edits, limits, bounded, abstractRoot, key: stable, constructors: [...shapes.keys()], symbolIntroducingEdgesAreUnitBounded: edits.every(e=>e.maxNewSymbols<=1)};
}

function registerAliasEdits(register, aliases, annotations) {
    register('renameBoundTableAlias', 'Rename a table alias and its bound references without capture', 0, function* (root) {
        for (const {node: select, path} of locations(root)) {
            if (!kind(select, 'Select') || !Array.isArray(select.slots.from)) continue;
            const from = select.slots.from;
            for (let index = 0; index < from.length; ++index) {
                const source = from[index];
                if (!kind(source, 'TableSource') || source.slots.expr || typeof source.attrs.table !== 'string') continue;
                const old = source.attrs.as ?? source.attrs.table;
                if (from.filter(other => (other?.attrs?.as ?? other?.attrs?.table) === old).length !== 1) continue;
                for (const name of aliases) {
                    if (name === old || from.some((other, i) => i !== index && (other?.attrs?.as ?? other?.attrs?.table) === name)) continue;
                    const renamed = renameBinding(select, old, name, true);
                    if (!renamed) continue;
                    const sources = renamed.slots.from.slice();
                    sources[index] = {...sources[index], attrs: {...sources[index].attrs, as: name}};
                    yield {path, after: {...renamed, slots: {...renamed.slots, from: sources}}};
                }
            }
        }
    }, annotations);
}
function renameBinding(node, old, name, top = false, scope = {oldVisible: true, newShadowed: false}) {
    if (!isNode(node)) return node;
    // Follow the binding being renamed, rather than blindly substituting text.
    // A local OLD binding shadows it; a local NEW binding can capture rewritten
    // OLD references, but leaves already-local NEW references unchanged.
    if (!top && kind(node, 'Select')) {
        const bindings = (node.slots.from || []).filter(isNode).map(source => source.attrs.as ?? source.attrs.table);
        scope = {oldVisible: scope.oldVisible && !bindings.includes(old), newShadowed: scope.newShadowed || bindings.includes(name)};
    }
    let attrs = node.attrs;
    if (kind(node, 'ColumnReference')) {
        // Introducing NEW must not repair an unbound qualifier, or capture an
        // outer binding with that name. This check also runs inside OLD-shadowing
        // scopes: skipping their entire subtree would miss NEW-reference capture.
        if (attrs.table === name && !scope.newShadowed) return null;
        if (attrs.table === old && scope.oldVisible) {
            if (scope.newShadowed || attrs.db != null) return null;
            attrs = {...attrs, table: name};
        }
    }
    const slots = {};
    for (const [field, value] of Object.entries(node.slots)) {
        if (Array.isArray(value)) {
            const next = value.map(child => renameBinding(child, old, name, false, scope));
            if (next.some((child, i) => value[i] != null && child == null)) return null;
            slots[field] = next;
        } else {
            slots[field] = renameBinding(value, old, name, false, scope);
            if (value != null && slots[field] == null) return null;
        }
    }
    return {...node, attrs, slots};
}

function registerJoinEdits(register, annotations, contextSafe) {
    register('relocateInnerJoinPredicate', 'Relocate a pure INNER JOIN predicate to/from WHERE', 0, function* (root) {
        for (const {node: select, path} of locations(root)) {
            if (!kind(select, 'Select') || !Array.isArray(select.slots.from) || select.slots.from.length < 2
                || !Array.isArray(select.slots.columns) || !select.slots.columns.length) continue;
            const from = select.slots.from;
            // Source order is unchanged, so SELECT * retains its column order.
            // USING/NATURAL can suppress columns and are deliberately excluded.
            if (from.some(source => !kind(source, 'TableSource') || source.slots.expr&&!contextSafe.querySafe(source.slots.expr,root) || source.attrs.natural
                || source.slots.using != null && (!Array.isArray(source.slots.using) || source.slots.using.length > 0)
                || source.attrs.join && !['INNER JOIN', 'CROSS JOIN'].includes(source.attrs.join))) continue;
            for (let index = 1; index < from.length; ++index) {
                const source = from[index];
                const safeWhere=!select.slots.where||pure(select.slots.where)&&contextSafe(select.slots.where,root,path)||contextSafe.querySafe(select,root);
                if(!safeWhere||source.slots.on&&!contextSafe(source.slots.on,root,path))continue;
                if (source.attrs.join === 'INNER JOIN' && pure(source.slots.on)) {
                    const allowed = new Set(from.slice(0, index + 1).map(table => table.attrs.as ?? table.attrs.table));
                    if ([...locations(source.slots.on)].some(({node}) => kind(node, 'ColumnReference') && node.attrs.table != null && !allowed.has(node.attrs.table))) continue;
                    const sources = from.slice();
                    sources[index] = {...source, attrs: {...source.attrs, join: null}, slots: {...source.slots, on: null}};
                    const where = select.slots.where ? binary('AND', select.slots.where, source.slots.on) : source.slots.on;
                    yield {path, after: {...select, slots: {...select.slots, from: sources, where}}};
                } else if (!source.attrs.join && !source.slots.on && select.slots.where) {
                    const choices = [{on: select.slots.where, where: null}];
                    if (kind(select.slots.where, 'BinaryExpression') && select.slots.where.attrs.operator === 'AND') {
                        choices.push({on: select.slots.where.slots.left, where: select.slots.where.slots.right},
                            {on: select.slots.where.slots.right, where: select.slots.where.slots.left});
                    }
                    const allowed = new Set(from.slice(0, index + 1).map(table => table.attrs.as ?? table.attrs.table));
                    for (const {on, where} of choices) {
                        if (!pure(on)||!contextSafe(on,root,path) || [...locations(on)].some(({node}) => kind(node, 'ColumnReference') && node.attrs.table != null && !allowed.has(node.attrs.table))) continue;
                        const sources = from.slice();
                        sources[index] = {...source, attrs: {...source.attrs, join: 'INNER JOIN'}, slots: {...source.slots, on}};
                        yield {path, after: {...select, slots: {...select.slots, from: sources, where}}};
                    }
                }
            }
        }
    }, annotations);
}

function registerOuterJoinEdits(register) {
    const one = () => ({kind: 'NumberLiteral', attrs: {value: '1', storageClass: 'integer'}, slots: {}});
    const truth = () => binary('=', one(), one());
    const isTruth = node => kind(node, 'BinaryExpression') && ['=', '=='].includes(node.attrs.operator)
        && [node.slots.left, node.slots.right].every(child => kind(child, 'NumberLiteral') && child.attrs.value === '1')
        && !containsCollation(node);
    register('relocateOuterJoinPredicate', 'Move a predicate between WHERE and an outer JOIN, charging for changed unmatched rows', 1, function* (root) {
        for (const {node: select, path} of locations(root)) {
            if (!kind(select, 'Select') || !Array.isArray(select.slots.from)) continue;
            for (let index = 1; index < select.slots.from.length; ++index) {
                const source = select.slots.from[index];
                if (!kind(source, 'TableSource') || !['LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN'].includes(source.attrs.join)) continue;
                const emit = (on, where) => {
                    const from = select.slots.from.slice();
                    from[index] = {...source, slots: {...source.slots, on}};
                    return {path, after: {...select, slots: {...select.slots, from, where}}};
                };
                if (isTruth(source.slots.on) && pure(select.slots.where)) {
                    yield emit(select.slots.where, null);
                    if (kind(select.slots.where, 'BinaryExpression') && select.slots.where.attrs.operator === 'AND') {
                        yield emit(select.slots.where.slots.left, select.slots.where.slots.right);
                        yield emit(select.slots.where.slots.right, select.slots.where.slots.left);
                    }
                } else if (pure(source.slots.on)) {
                    yield emit(truth(), select.slots.where ? binary('AND', select.slots.where, source.slots.on) : source.slots.on);
                }
                // A student often retains the joining key while moving only a
                // filter. Keep that common logical error a real paid edge;
                // moving it is not an outer-JOIN equivalence.
                if (pure(source.slots.on) && pure(select.slots.where)) {
                    yield emit(binary('AND', source.slots.on, select.slots.where), null);
                    if (kind(select.slots.where, 'BinaryExpression') && select.slots.where.attrs.operator === 'AND') {
                        yield emit(binary('AND', source.slots.on, select.slots.where.slots.left), select.slots.where.slots.right);
                        yield emit(binary('AND', source.slots.on, select.slots.where.slots.right), select.slots.where.slots.left);
                    }
                }
                if (pure(source.slots.on) && kind(source.slots.on, 'BinaryExpression') && source.slots.on.attrs.operator === 'AND') {
                    for (const [retained, moved] of [[source.slots.on.slots.left, source.slots.on.slots.right], [source.slots.on.slots.right, source.slots.on.slots.left]]) {
                        yield emit(retained, select.slots.where ? binary('AND', select.slots.where, moved) : moved);
                    }
                }
            }
        }
    }, {maxNewSymbols: 1});
}
