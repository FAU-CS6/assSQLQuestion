import {predicateFacts} from './graph-features.mjs';
import {minimumEffectRatio, ceilEffect} from './integer-bound.mjs';

function relationNames(root) {
    const names = new Set();
    const visit = (node, inReference = false) => {
        if (!node?.kind) return;
        inReference ||= node.kind === 'ReferenceDefinition';
        if (!inReference && node.kind === 'TableSource' && typeof node.attrs.table === 'string') names.add(node.attrs.table);
        for (const value of Object.values(node.slots)) for (const child of Array.isArray(value) ? value : [value]) visit(child, inReference);
    };
    visit(root); return names;
}

function projectedAggregates(select) {
    const names = new Set();
    const visit = node => {
        if (!node?.kind) return;
        if (node.kind === 'AggregateExpression' && typeof node.attrs.name === 'string') names.add(node.attrs.name);
        for (const value of Object.values(node.slots)) for (const child of Array.isArray(value) ? value : [value]) visit(child);
    };
    for (const item of select.slots.columns || []) visit(item);
    return [...names].sort().join('\n');
}

/** Relaxed sequence alignment of top-level statements. A local SQL edit can
 * change only one entry; statement insertion/deletion are separate paid edges.
 * Each unequal entry costs at most the cheapest fact-changing local edit.
 * This counts repeated mistakes in different statements without counting the
 * many contextual signatures that one binding change can affect at once.
 */
export function createStatementBound(reference, graph) {
    const disabled = {measure: () => 0, decrease: () => 0};
    if (graph.statementLocalEdits !== true || reference?.kind !== 'Script'
        || graph.edits.some(e => !Number.isSafeInteger(e.cost) || e.cost < 0
            || !Number.isSafeInteger(e.maxNewPredicates) || e.maxNewPredicates < 0
            || !Number.isSafeInteger(e.maxNewRelations) || e.maxNewRelations < 0
            || e.statementOperation === undefined)) return disabled;
    const changesDistinct = edit => ['setSelectDistinct', 'changeSelectDistinct', 'unsetSelectDistinct'].includes(edit.name);
    const distinctEdits = graph.edits.filter(changesDistinct);
    const distinctUnit = distinctEdits.length ? Math.min(...distinctEdits.map(edit => edit.cost)) : 0;
    const local = graph.edits.filter(e => !e.statementOperation && e.maxNewPredicates > 0 && !changesDistinct(e));
    const unit = local.length ? Math.min(...local.map(e => e.cost)) : 0;
    const sourceMutation = edit => edit.maxNewRelations > 0 || edit.maxNewSources > 0
        || /^remove.*TableSource$/.test(edit.name) || /^(?:set|change|unset)TableSourceTable$/.test(edit.name);
    const sourceEdits = graph.edits.filter(sourceMutation);
    // Deleting a FROM source may both make an implicit label unresolvable and
    // remove its ON predicate. Reserve two units against that structural edge.
    const labelUnit = graph.independentProjectionLabels && typeof graph.projectionLabels === 'function'
        ? Math.min(unit, sourceEdits.length ? Math.floor(Math.min(...sourceEdits.map(e => e.cost)) / 2) : 0) : 0;
    const relationRatio = minimumEffectRatio(graph.edits, 'maxNewRelations');
    const rates = operation => {
        const result = new Map();
        for (const edit of graph.edits) if (edit.statementOperation === operation) {
            result.set(edit.statementKind, Math.min(result.get(edit.statementKind) ?? Infinity, edit.cost));
        }
        return result;
    };
    const additions = rates('add'), removals = rates('remove'), cache = new WeakMap();
    const signature = node => [...(graph.predicateFacts || predicateFacts)(
        {kind: 'Script', attrs: {}, slots: {statements: [node]}})]
        .filter(fact => !fact.startsWith('["distinct",')).sort().join('\n');
    const sequence = root => {
        const normalized = graph.abstractRoot ? graph.abstractRoot(root) : root;
        return (normalized.slots.statements || []).map((node, index) => {
            if (!cache.has(node)) cache.set(node, {kind: node.kind, relations: relationNames(node), facts: signature(node),
                distinct: node.kind === 'Select' && node.attrs.distinct === true,
                aggregateNames: node.kind === 'Select' ? projectedAggregates(node) : null,
                ordered: node.kind === 'Select' && Boolean(node.slots.orderby?.length),
                labels: labelUnit && node.kind === 'Select' ? graph.projectionLabels(root.slots.statements[index]) : null,
                filter: labelUnit && node.kind === 'Select' ? signature({kind: 'Select', attrs: {},
                    slots: {from: node.slots.from, where: node.slots.where}}) : null,
                // Every local UPDATE edit touches either SET or WHERE, never
                // both. Statement deletion/insertion is handled by alignment.
                // Normalize the whole script above before slicing so task-
                // permitted labels retain their surrounding query context.
                parts: node.kind === 'Update' ? ['set', 'where'].map(field => signature(
                    {kind: 'Update', attrs: {}, slots: {[field]: node.slots[field]}})) : null});
            return cache.get(node);
        });
    };
    const destination = sequence(reference);
    const price = (map, kind) => map.get(kind) ?? 0;
    return {
        measure(root) {
            if (root?.kind !== 'Script') return 0;
            const source = sequence(root);
            let row = [0];
            for (const target of destination) row.push(row.at(-1) + price(additions, target.kind));
            for (const current of source) {
                const next = [row[0] + price(removals, current.kind)];
                for (let j = 0; j < destination.length; ++j) {
                    const target = destination[j];
                    const missing = [...target.relations].filter(name => !current.relations.has(name)).length;
                    const nonDistinctWork = Math.max(current.facts === target.facts ? 0 : unit,
                        current.parts && target.parts ? current.parts.reduce((sum, value, i) => sum + (value === target.parts[i] ? 0 : unit), 0) : 0,
                        current.kind === 'Select' && target.kind === 'Select' ? labelUnit * (
                            Number(current.labels !== null && target.labels !== null && current.labels !== target.labels)
                            + Number(current.filter !== target.filter)) : 0,
                        // Projection edits and root ORDER BY edits affect
                        // separate slots. Even alias insertion cannot create
                        // or remove the ORDER BY list. Statement replacement
                        // pays the independent alignment costs below.
                        current.kind === 'Select' && target.kind === 'Select'
                            && !graph.ddlWorkOptions?.freeLabels?.length && !graph.ddlWorkOptions?.freeDiagnostics
                            ? unit * (Number(current.aggregateNames !== target.aggregateNames)
                                + Number(current.ordered !== target.ordered)) : 0,
                        ceilEffect(relationRatio, missing));
                    // A root SELECT DISTINCT attribute edit cannot alter any
                    // remaining signature, relation, SET or WHERE partition.
                    // Top-level replacement still pays the alignment prices.
                    const substitution = nonDistinctWork + (current.distinct === target.distinct ? 0 : distinctUnit);
                    next.push(Math.min(next[j] + price(additions, target.kind),
                        row[j + 1] + price(removals, current.kind),
                        current.kind === target.kind ? row[j] + substitution : Infinity));
                }
                row = next;
            }
            return Math.min(Number.MAX_SAFE_INTEGER, row.at(-1));
        },
        decrease(edit) {
            return edit.statementOperation === 'add' ? price(additions, edit.statementKind)
                : edit.statementOperation === 'remove' ? price(removals, edit.statementKind)
                : changesDistinct(edit) ? distinctUnit : Math.max(edit.maxNewPredicates > 0 ? unit : 0,
                    sourceMutation(edit) ? labelUnit * 2 : edit.maxNewPredicates > 0 ? labelUnit : 0,
                    ceilEffect(relationRatio, edit.maxNewRelations || 0));
        }
    };
}
