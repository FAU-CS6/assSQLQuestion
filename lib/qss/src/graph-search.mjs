/** Exact search in an implicit, directed SQL-edit graph (paper sections 4.2–4.6). */
import {stableKey as graphModelKey} from './graph-model.mjs';
import {symbolFacts, predicateFacts} from './graph-features.mjs';
import {createStructuralGuide} from './graph-guide.mjs';
import {findReverseZeroWitness} from './graph-reverse-witness.mjs';
import {minimumEffectRatio, ceilRatio, ceilEffect} from './integer-bound.mjs';
import {createStatementBound} from './statement-bound.mjs';
import {createDdlWorkBound} from './ddl-work-bound.mjs';
import {createOrderedComparisonBound} from './ordered-comparison-bound.mjs';
import {createAtomicPredicateBound} from './atomic-predicate-bound.mjs';
export {symbolFacts, predicateFacts} from './graph-features.mjs';

class Heap {
    values = [];
    serial = 0;
    push(value, priority, tie = 0, guide = 0) {
        const entry = {value, priority, tie, guide, serial: this.serial++}, a = this.values;
        a.push(entry); let i = a.length - 1;
        while (i) {
            const p = (i - 1) >> 1;
            if (this.compare(a[p], entry) <= 0) break;
            a[i] = a[p]; i = p;
        }
        a[i] = entry;
    }
    compare(a, b) { return a.priority - b.priority || a.tie - b.tie
        // Finish the eligible edit families of a node before selecting its
        // children by the scheduling guide. Otherwise an early, mildly closer
        // free child can starve a much better neighbour from a later family.
        || Number(b.value.type==='edit')-Number(a.value.type==='edit')
        || a.guide-b.guide || a.serial - b.serial; }
    pop() {
        const a = this.values, first = a[0], last = a.pop();
        if (a.length) {
            let i = 0;
            while (i * 2 + 1 < a.length) {
                let c = i * 2 + 1;
                if (c + 1 < a.length && this.compare(a[c + 1], a[c]) < 0) ++c;
                if (this.compare(a[c], last) >= 0) break;
                a[i] = a[c]; i = c;
            }
            a[i] = last;
        }
        return first;
    }
    get length() { return this.values.length; }
}

export function missingSymbols(root, destinationFacts) {
    const present = symbolFacts(root);
    let missing = 0;
    for (const fact of destinationFacts) if (!present.has(fact)) ++missing;
    return missing;
}

function relationWork(root) {
    const names=new Set();let sources=0;
    const visit=(n,inForeignKey=false)=>{if(!n?.kind)return;inForeignKey ||= n.kind==='ReferenceDefinition';if(n.kind==='TableSource'&&!inForeignKey){
        sources++;if(typeof n.attrs.table==='string')names.add(n.attrs.table);
    }for(const v of Object.values(n.slots))for(const c of Array.isArray(v)?v:[v])visit(c,inForeignKey);};visit(root);
    return {names,sources};
}

/**
 * The optional admissible heuristic is certified by the edit catalogue, NOT by
 * matching only target positions. All applicable neighbours are still generated.
 * Custom zero-price symbol-creating edits disable this heuristic automatically.
 * An edit lacking an explicit effect bound also disables it.
 */
export function heuristicCertificate(edits, field = 'maxNewSymbols') {
    if (edits.some(edit => !Number.isSafeInteger(edit[field]) || edit[field] < 0)) return {enabled: false, unit: 0};
    const introducing = edits.filter(edit => edit[field] > 0);
    if (!introducing.length) return {enabled: false, unit: 0};
    const unit = Math.min(...introducing.map(edit => edit.cost / edit[field]));
    return {enabled: unit > 0, unit};
}

function distinctCount(root) {
    if (!root) return 0;
    let count = root.kind === 'Select' && root.attrs.distinct === true ? 1 : 0;
    for (const value of Object.values(root.slots)) for (const child of Array.isArray(value) ? value : [value]) count += distinctCount(child);
    return count;
}
function statements(root) {
    const counts = new Map();
    for (const node of root.kind === 'Script' ? root.slots.statements || [] : []) counts.set(node.kind, (counts.get(node.kind) || 0) + 1);
    return counts;
}
const workComponents = new Set(['Definition', 'DataType', 'SelectItem', 'OrderByItem']);
function componentCounts(root, counts = new Map()) {
    if (!root) return counts;
    if (workComponents.has(root.kind)) counts.set(root.kind, (counts.get(root.kind) || 0) + 1);
    for (const value of Object.values(root.slots)) for (const child of Array.isArray(value) ? value : [value]) componentCounts(child, counts);
    return counts;
}

// Equal lower bounds may be expanded in any order without changing distances.
// Prefer small SQL attribute repairs before potentially enormous constructor
// families. This fixed ordering never examines target positions or omits edits.
function editOrder(edit) {
    if (/^change.*(?:Value|Length|Scale|Operator)$/.test(edit.name) || edit.name === 'changeLiteral') return 0;
    if (/^change/.test(edit.name)) return 1;
    if (/^(?:set|unset)/.test(edit.name)) return 2;
    if (!/^(?:add|remove)/.test(edit.name) || edit.name === 'removeExtraneousBinaryTerm') return 3;
    return edit.name.startsWith('remove') ? 4 : 5;
}

/** Cost partitioning for disjoint, necessary SQL work, not greedy repair.
 * Shallow statement constructors add no symbols or DISTINCT flags; DISTINCT
 * setters add no symbols. The per-edge charge is checked before summing these
 * bounds. An extended catalogue with overlapping effects falls back to MAX.
 */
export function sqlWorkBound(reference, graph, symbolUnit) {
    const distinct = heuristicCertificate(graph.edits, 'maxNewDistinct');
    const distinctUnit = distinct.enabled ? distinct.unit : 0;
    const statementRates = new Map();
    const componentRates = new Map();
    const declaredStatements = graph.edits.every(edit => edit.statementOperation !== undefined);
    if (declaredStatements) for (const edit of graph.edits) if (edit.statementOperation) {
        const key = edit.statementOperation + ':' + edit.statementKind;
        statementRates.set(key, Math.min(statementRates.get(key) ?? Infinity, edit.cost));
    }
    if (graph.edits.every(edit => edit.introducedComponent !== undefined&&edit.componentWorkBounded!==false)) {
        for (const edit of graph.edits) if (workComponents.has(edit.introducedComponent)) {
            componentRates.set(edit.introducedComponent, Math.min(componentRates.get(edit.introducedComponent) ?? Infinity, edit.cost));
        }
    }
    const charge = edit => [symbolUnit * (edit.maxNewSymbols || 0), distinctUnit * (edit.maxNewDistinct || 0),
        edit.statementOperation ? statementRates.get(edit.statementOperation + ':' + edit.statementKind) || 0 : 0,
        componentRates.get(edit.introducedComponent) || 0];
    const disjoint = graph.edits.every(edit => charge(edit).reduce((sum, cost) => sum + cost, 0) <= edit.cost);
    const combine = parts => disjoint ? parts.reduce((sum, cost) => sum + cost, 0) : Math.max(0, ...parts);
    const symbolRatio = symbolUnit > 0 ? minimumEffectRatio(graph.edits, 'maxNewSymbols') : {numerator: 0n, denominator: 1n};
    const distinctRatio = minimumEffectRatio(graph.edits, 'maxNewDistinct');
    const denominator = symbolRatio.denominator * distinctRatio.denominator;
    const symbolWeight = symbolRatio.numerator * distinctRatio.denominator;
    const distinctWeight = distinctRatio.numerator * symbolRatio.denominator;
    const integerChargeParts = edit => [symbolWeight === 0n ? 0n : symbolWeight * BigInt(edit.maxNewSymbols || 0),
        distinctWeight === 0n ? 0n : distinctWeight * BigInt(edit.maxNewDistinct || 0),
        denominator * BigInt(edit.statementOperation ? statementRates.get(edit.statementOperation + ':' + edit.statementKind) || 0 : 0),
        denominator * BigInt(componentRates.get(edit.introducedComponent) || 0)];
    const integerDisjoint = graph.edits.every(edit => integerChargeParts(edit).reduce((sum, value) => sum + value, 0n)
        <= BigInt(edit.cost) * denominator);
    const integerCombine = parts => integerDisjoint ? parts.reduce((sum, value) => sum + value, 0n)
        : parts.reduce((largest, value) => value > largest ? value : largest, 0n);
    const exactDecreases = new Map(graph.edits.map(edit => [edit, integerCombine(integerChargeParts(edit))]));
    const integerDecreases = new Map(graph.edits.map(edit =>
        [edit, ceilRatio(exactDecreases.get(edit), denominator)]));
    const destinationStatements = statements(reference), destinationDistinct = distinctCount(reference), destinationComponents = componentCounts(reference);
    const workCounts = root => {
        const present = statements(root);
        let statementCost = 0n;
        for (const name of new Set([...destinationStatements.keys(), ...present.keys()])) {
            const difference = (destinationStatements.get(name) || 0) - (present.get(name) || 0);
            statementCost += BigInt(Math.abs(difference)) * BigInt(statementRates.get((difference > 0 ? 'add:' : 'remove:') + name) || 0);
        }
        const presentComponents = componentCounts(root);
        let componentCost = 0n;
        for (const [name, count] of destinationComponents) {
            componentCost += BigInt(Math.max(0, count - (presentComponents.get(name) || 0))) * BigInt(componentRates.get(name) || 0);
        }
        return {distinct: Math.max(0, destinationDistinct - distinctCount(root)), statementCost, componentCost};
    };
    return {
        enabled: symbolUnit > 0 || distinctUnit > 0 || [...statementRates.values(), ...componentRates.values()].some(rate => rate > 0),
        decrease: edit => combine(charge(edit)),
        // If an integer path must cost at least n/d, it must cost at least
        // ceil(n/d). BigInt division avoids rounding a value just above an
        // integer incorrectly. Ceil(a)-ceil(b) <= ceil(a-b) also makes the
        // rounded per-edit decrease safe. The actual lazy schedule retains
        // the unrounded numerator and subtracts the exact decrease first, so
        // separate rounding never weakens a pending family's certificate.
        integerDecrease: edit => integerDecreases.get(edit),
        exactRemaining: (numerator, edit) => {
            const remaining = numerator - exactDecreases.get(edit);
            return remaining > 0n ? ceilRatio(remaining, denominator) : 0;
        },
        exactMeasure(root, symbolCount) {
            const counts = workCounts(root);
            const numerator = integerCombine([symbolWeight * BigInt(symbolCount),
                distinctWeight * BigInt(counts.distinct), denominator * counts.statementCost,
                denominator * counts.componentCost]);
            return {numerator, bound: ceilRatio(numerator, denominator)};
        },
        integerMeasure(root, symbolCount) {
            return this.exactMeasure(root, symbolCount).bound;
        },
        measure(root, symbolCost) {
            const present = statements(root);
            let statementCost = 0;
            for (const name of new Set([...destinationStatements.keys(), ...present.keys()])) {
                const difference = (destinationStatements.get(name) || 0) - (present.get(name) || 0);
                statementCost += Math.abs(difference) * (statementRates.get((difference > 0 ? 'add:' : 'remove:') + name) || 0);
            }
            const presentComponents = componentCounts(root);
            let componentCost = 0;
            for (const [name, count] of destinationComponents) {
                componentCost += Math.max(0, count - (presentComponents.get(name) || 0)) * (componentRates.get(name) || 0);
            }
            return combine([symbolCost, Math.max(0, destinationDistinct - distinctCount(root)) * distinctUnit, statementCost, componentCost]);
        }
    };
}

export async function shortestSqlEditPath(reference, answer, graph, context, {cutoff = Infinity, useHeuristic = true} = {}) {
    const stableKey = graph.key || graphModelKey;
    const structuralTieDistance = createStructuralGuide();
    const destinationKey = stableKey(reference), startKey = stableKey(answer);
    const certificate = heuristicCertificate(graph.edits);
    const unit = useHeuristic && certificate.enabled ? certificate.unit : 0;
    // A surplus symbol also requires a paid change: the declared preserving
    // edges cannot remove it. This is a binary bound, never a count of extras.
    // A custom free non-preserving edit disables the certificate automatically.
    const removing = graph.edits.filter(edit => edit.preservesSymbolSet !== true);
    const removalRate = removing.length ? Math.min(...removing.map(edit => edit.cost)) : 0;
    const extraUnit = useHeuristic && graph.edits.every(edit => typeof edit.preservesSymbolSet === 'boolean')
        && Number.isFinite(removalRate) ? removalRate : 0;
    const predicateCertificate = heuristicCertificate(graph.edits, 'maxNewPredicates');
    const predicateUnit = useHeuristic && predicateCertificate.enabled ? predicateCertificate.unit : 0;
    const relationCertificate=heuristicCertificate(graph.edits,'maxNewRelations');
    const sourceCertificate=heuristicCertificate(graph.edits,'maxNewSources');
    const relationUnit=useHeuristic&&relationCertificate.enabled?relationCertificate.unit:0;
    const sourceUnit=useHeuristic&&sourceCertificate.enabled?sourceCertificate.unit:0;
    const predicateRatio = minimumEffectRatio(graph.edits, 'maxNewPredicates');
    const relationRatio = minimumEffectRatio(graph.edits, 'maxNewRelations');
    const sourceRatio = minimumEffectRatio(graph.edits, 'maxNewSources');
    const destinationRelations=relationWork(reference);
    const work = useHeuristic ? sqlWorkBound(reference, graph, unit)
        : {exactMeasure: () => ({numerator: 0n, bound: 0}), exactRemaining: () => 0};
    const statementWork = useHeuristic ? createStatementBound(reference, graph) : {measure: () => 0, decrease: () => 0};
    const ddlWork = useHeuristic ? createDdlWorkBound(reference, graph.edits, graph.ddlWorkOptions)
        : {exactMeasure: () => ({work: {constraints: 0, strings: 0, types: 0, check: 0}, bound: 0}), exactRemaining: () => 0};
    const orderedWork = useHeuristic ? createOrderedComparisonBound(reference, graph.edits) : {measure: () => 0, remaining: () => 0};
    const atomicWork = useHeuristic ? createAtomicPredicateBound(reference, graph, {requirements: graph.ddlWorkOptions})
        : {exactMeasure: () => ({missing: 0, numerator: 0n, bound: 0}), exactRemaining: () => 0};
    const abstract=root=>graph.abstractRoot?graph.abstractRoot(root):root;
    const symbolsOf = graph.symbolFacts || symbolFacts, predicatesOf = graph.predicateFacts || predicateFacts;
    const facts = symbolsOf(abstract(reference)), predicates = predicatesOf(abstract(reference));
    const heuristic = (root, orderedComparisons = orderedWork.measure(root)) => {
        const normalized=abstract(root),have=unit||extraUnit?symbolsOf(normalized):null;
        const symbolCount = unit ? [...facts].filter(fact=>!have.has(fact)).length : 0;
        const extraSymbols = extraUnit && [...have].some(fact => !facts.has(fact)) ? extraUnit : 0;
        const present = predicateUnit ? predicatesOf(normalized) : null;
        let missing = 0;
        if (present) {
            for (const fact of predicates) if (!present.has(fact)) ++missing;
            // Free edits preserve the complete abstract fact set. An extra
            // projection/constraint is just as much evidence of a necessary
            // paid edit as a missing one. This remains a binary bound.
            if(!missing)for(const fact of present)if(!predicates.has(fact)){missing=1;break;}
        }
        // Predicate/binding changes can affect many signatures in one paid
        // edit. Only their presence/absence yields a certified one-edit bound.
        const presentRelations=relationWork(root);let absentRelations=0;
        for(const name of destinationRelations.names)if(!presentRelations.names.has(name))absentRelations++;
        const budget = work.exactMeasure(root, symbolCount);
        const ddl = ddlWork.exactMeasure(root);
        const atomic = atomicWork.exactMeasure(root);
        const predicateCount = predicateUnit && missing ? 1 : 0;
        const relationCount = relationUnit ? absentRelations : 0;
        const sourceCount = sourceUnit ? Math.max(0,destinationRelations.sources-presentRelations.sources) : 0;
        return {budget: budget.bound, budgetNumerator: budget.numerator, extraSymbols,
            statementWork: statementWork.measure(root),
            ddlWork: ddl.bound, ddlMeasurement: ddl,
            orderedComparisons,
            atomicPredicates: atomic.bound, atomicMeasurement: atomic,
            predicateCount, relationCount, sourceCount,
            predicates: ceilEffect(predicateRatio, predicateCount),
            relations: ceilEffect(relationRatio, relationCount), sources: ceilEffect(sourceRatio, sourceCount)};
    };
    const maximumBound = bounds => Math.max(bounds.budget, bounds.extraSymbols, bounds.predicates, bounds.relations, bounds.sources, bounds.statementWork, bounds.ddlWork, bounds.orderedComparisons, bounds.atomicPredicates);
    const remainingBound = (bounds, edit) => Math.max(0,
        work.exactRemaining(bounds.budgetNumerator, edit),
        bounds.statementWork - statementWork.decrease(edit),
        ddlWork.exactRemaining(bounds.ddlMeasurement, edit),
        orderedWork.remaining(bounds.orderedComparisons, edit),
        atomicWork.exactRemaining(bounds.atomicMeasurement, edit),
        bounds.extraSymbols - (edit.preservesSymbolSet === true ? 0 : extraUnit),
        predicateUnit ? ceilEffect(predicateRatio, Math.max(0, bounds.predicateCount - edit.maxNewPredicates)) : 0,
        relationUnit ? ceilEffect(relationRatio, Math.max(0, bounds.relationCount - edit.maxNewRelations)) : 0,
        sourceUnit ? ceilEffect(sourceRatio, Math.max(0, bounds.sourceCount - edit.maxNewSources)) : 0);
    const queue = new Heap(), best = new Map(), expanded = new Map(), lowerBounds = new Map();
    let incumbent = null;
    const ceiling = () => Math.min(cutoff, incumbent?.distance ?? Infinity);
    // Every state with the same cost and certified bounds has exactly the same
    // lazy edit schedule. Share its immutable array instead of retaining one
    // object per edit family per queued state (hundreds of families for DDL).
    // Include the distance to preserve the original floating-point arithmetic
    // and stable sort order, not just the mathematically equivalent offsets.
    const schedules = new Map();
    const editSchedule = node => {
        const b = node.bounds;
        const key = JSON.stringify([node.distance, b.budgetNumerator.toString(), b.extraSymbols,
            b.predicateCount, b.relationCount, b.sourceCount, b.statementWork,
            b.ddlMeasurement.work.constraints, b.ddlMeasurement.work.strings, b.ddlMeasurement.work.types, b.ddlMeasurement.work.check, b.orderedComparisons,
            b.atomicMeasurement.missing]);
        if (!schedules.has(key)) schedules.set(key, graph.edits.map(edit => ({edit,
            bound: node.distance + edit.cost + remainingBound(b, edit)
        })).filter(entry => entry.bound < cutoff)
            .sort((a, b) => a.bound - b.bound || b.edit.cost - a.edit.cost || editOrder(a.edit) - editOrder(b.edit)));
        return schedules.get(key);
    };
    let settled = 0, generated = 1;
    const startBound = heuristic(answer);
    const initial = {root: answer, key: startKey, distance: 0, bounds: startBound,
        h: maximumBound(startBound), previous: null, edge: null};
    lowerBounds.set(startKey, initial.h);
    best.set(startKey, initial);
    initial.guide=structuralTieDistance(answer,reference);
    queue.push({type: 'node', node: initial}, initial.h,0,initial.guide);
    const trace = node => {
        const result = [];
        for (let n = node; n.previous; n = n.previous) result.push(n.edge);
        return result.reverse();
    };
    const result = (node, capped = false) => ({
        distance: capped ? cutoff : node.distance, edits: capped ? [] : trace(node), capped,
        visited: settled, generated, frontier: queue.length,
        search: unit || extraUnit || predicateUnit || work.enabled || relationUnit || sourceUnit ? 'exact-lazy-a-star' : 'exact-lazy-uniform-cost',
        heuristic: unit || extraUnit || predicateUnit || work.enabled || relationUnit || sourceUnit ? 'admissible-integer-sql-work-and-expression-bounds-v4' : 'zero',
        startKey, destinationKey, finalKey: capped ? null : node.key,
        limits: graph.limits
    });
    // A directly witnessed path supplies an upper bound. When its cost equals
    // the certified GLOBAL lower bound at the start, it is already optimal:
    // lowerBound <= shortestDistance <= directCost == lowerBound. This is an
    // additional certificate, not a target-guided restriction of the graph.
    // Otherwise the complete lazy search below remains unchanged. Use exact
    // equality; approximate numeric agreement is not an optimality proof.
    if (startKey !== destinationKey && Number.isFinite(initial.h) && initial.h >= 0 && initial.h < cutoff) {
        context.frontier = queue.length;
        context.lowerBound = initial.h;
        const directEdits = graph.edits.filter(edit => Number.isSafeInteger(edit.cost) && edit.cost === initial.h)
            .sort((a, b) => editOrder(a) - editOrder(b));
        for (const edit of directEdits) {
            await context.tick();
            for (const neighbour of edit.apply(answer)) {
                await context.tick();
                ++generated;
                const key = stableKey(neighbour.root);
                if (key !== destinationKey) continue;
                const next = {root: neighbour.root, key, distance: edit.cost, h: 0,
                    bounds: {budget: 0, extraSymbols: 0, predicates: 0,relations:0,sources:0}, previous: initial,
                    edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
                        path: neighbour.operation?.path || [], operation: neighbour.operation}};
                return {...result(next), frontier: 0,
                    search: 'exact-direct-bound-certificate', heuristic: 'matching-global-start-lower-bound'};
            }
        }
    }
    // A witnessed all-zero path is optimal under ANY nonnegative edit costs.
    // Two finite monotone scheduling passes can find such a certificate without
    // expanding the whole free closure. Failure merely falls through to the
    // complete search; these guides never supply a distance or a score.
    if(startKey!==destinationKey&&initial.h===0)for(const weighted of [false,true]){
        let node=initial,guide=structuralTieDistance(answer,reference,weighted);
        while(guide>0){
            let chosen=null,nextGuide=guide;
            for(const edit of graph.edits)if(edit.cost===0){
                await context.tick();
                for(const edge of edit.apply(node.root)){
                    await context.tick();const candidate=structuralTieDistance(edge.root,reference,weighted);
                    if(candidate>=nextGuide)continue;
                    nextGuide=candidate;chosen={root:edge.root,key:stableKey(edge.root),distance:0,previous:node,
                        edge:{type:'sql-edit',name:edit.name,description:edit.description,cost:0,path:edge.operation.path,operation:edge.operation}};++generated;
                }
            }
            if(!chosen)break;node=chosen;guide=nextGuide;
            if(node.key===destinationKey)return{...result(node),frontier:0,search:'exact-zero-path-certificate',heuristic:'nonnegative-costs-and-witnessed-free-path'};
        }
    }
    // The opposite scheduling direction can avoid a forward guide plateau.
    // Outgoing reference edges are not assumed reversible: this helper must
    // generate and replay every edge in the actual answer-to-reference graph.
    // Only a witnessed all-zero path proves optimality; failure leaves the
    // complete search and its admissible bounds unchanged.
    if (startKey !== destinationKey && initial.h === 0) {
        const witness = await findReverseZeroWitness(reference, answer, graph, context,
            {guide: structuralTieDistance});
        generated += witness.generated;
        if (witness.edges) {
            let node = initial;
            for (const edge of witness.edges) node = {root: edge.root, key: stableKey(edge.root), distance: 0,
                previous: node, edge: {type: 'sql-edit', name: edge.name, description: edge.description,
                    cost: 0, path: edge.operation.path, operation: edge.operation}};
            return {...result(node), frontier: 0, search: 'exact-directed-zero-witness-certificate',
                heuristic: 'nonnegative-costs-and-replayed-directed-free-path'};
        }
    }
    // Two finite, monotone guide walks may supply a concrete upper bound even
    // when the admissible start bound is smaller. Keep only one next node, not
    // a branching candidate tree. The nonnegative integer guide decreases at
    // every step, so these optional walks need no time/node/depth budget.
    // Failure changes nothing about the graph searched below. Success alone
    // is NOT an optimality certificate: only the global lower bound can prove
    // that no cheaper path (including a non-monotone detour) remains.
    if (startKey !== destinationKey && initial.h < cutoff) for (const weighted of [false, true]) {
        let node = initial, guide = structuralTieDistance(answer, reference, weighted);
        while (guide > 0) {
            let chosen = null, chosenGuide = guide;
            for (const edit of graph.edits) {
                const distance = node.distance + edit.cost;
                if (distance >= ceiling() || distance + remainingBound(node.bounds, edit) >= ceiling()) continue;
                if (!Number.isSafeInteger(distance)) throw new RangeError('The SQL-edit path exceeds exact integer distance precision.');
                await context.tick();
                for (const neighbour of edit.apply(node.root)) {
                    await context.tick(); ++generated;
                    const nextGuide = structuralTieDistance(neighbour.root, reference, weighted);
                    if (nextGuide >= guide || nextGuide > chosenGuide
                        || nextGuide === chosenGuide && chosen && distance >= chosen.distance) continue;
                    // This already certified scalar bound is cheap. Reject
                    // only states the full MAX bound would also reject, before
                    // allocating their occurrence-aware expression facts.
                    const orderedComparisons = orderedWork.measure(neighbour.root);
                    if (distance + orderedComparisons >= ceiling()) continue;
                    const bounds = heuristic(neighbour.root, orderedComparisons);
                    if (distance + maximumBound(bounds) >= ceiling()) continue;
                    chosenGuide = nextGuide;
                    chosen = {root: neighbour.root, key: stableKey(neighbour.root), distance, bounds,
                        previous: node, edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
                            path: neighbour.operation?.path || [], operation: neighbour.operation}};
                    if (chosen.key === destinationKey) {
                        // Tighten the upper bound immediately; later expensive
                        // families in this same guide walk need not run.
                        incumbent = chosen;
                        if (distance === initial.h) return {...result(chosen), frontier: 0,
                            search: 'exact-witness-bound-certificate', heuristic: 'matching-global-start-lower-bound'};
                    }
                }
            }
            if (!chosen) break;
            node = chosen; guide = chosenGuide;
            if (node.key !== destinationKey) continue;
            incumbent = node;
            if (node.distance === initial.h) return {...result(node), frontier: 0,
                search: 'exact-witness-bound-certificate', heuristic: 'matching-global-start-lower-bound'};
            break;
        }
    }
    while (queue.length) {
        const entry = queue.pop(), task = entry.value, node = task.node;
        if (best.get(node.key) !== node) continue;
        context.frontier = queue.length + 1;
        context.lowerBound = entry.priority;
        await context.tick();
        // This is the smallest pending lower bound, including lazy families.
        // Equality is sufficient: an equal-cost alternate path cannot improve
        // the already witnessed path. Reopened nodes are still handled below.
        if (incumbent && entry.priority >= incumbent.distance) return result(incumbent);
        if (entry.priority >= cutoff) return result(node, true);
        if (task.type === 'node') {
            if (expanded.has(node.key) && expanded.get(node.key) <= node.distance) continue;
            expanded.set(node.key, node.distance); ++settled; context.visited = settled;
            if (node.key === destinationKey) return result(node);
            // Lower bounds on each not-yet-generated edit's neighbours. This is
            // the paper's lazy generation extended to an admissible heuristic.
            // Families whose certified bound already reaches zero points
            // cannot yield a positive score. Exhausting the remaining queue
            // certifies the same cutoff; this is not a resource/time limit.
            const edits = editSchedule(node);
            if (edits.length && edits[0].bound < ceiling()) queue.push({type: 'edit', node, edits, index: 0}, edits[0].bound, -node.distance - edits[0].edit.cost,node.guide);
            continue;
        }
        const {edit} = task.edits[task.index];
        if (!Number.isSafeInteger(node.distance + edit.cost)) throw new RangeError('The SQL-edit path exceeds exact integer distance precision.');
        for (const neighbour of edit.apply(node.root)) {
            await context.tick();
            ++generated;
            const key = stableKey(neighbour.root), distance = node.distance + edit.cost;
            if (best.has(key) && best.get(key).distance <= distance) continue;
            // A rejected immutable state often reappears through another edit
            // family. Its certified lower bound remains valid, and the upper
            // ceiling only decreases. Retain a number, not the discarded AST.
            if (lowerBounds.has(key) && distance + lowerBounds.get(key) >= ceiling()) continue;
            const orderedComparisons = orderedWork.measure(neighbour.root);
            if (distance + orderedComparisons >= ceiling()) {
                lowerBounds.set(key, orderedComparisons);
                continue;
            }
            const bounds = heuristic(neighbour.root, orderedComparisons), h = maximumBound(bounds);
            lowerBounds.set(key, h);
            if (distance + h >= ceiling()) continue;
            const next = {root: neighbour.root, key, distance, h, bounds,guide:structuralTieDistance(neighbour.root,reference), previous: node,
                edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
                    path: neighbour.operation?.path || [], operation: neighbour.operation}};
            // This task was the smallest lower bound in the entire queue. If a
            // generated goal attains that bound, no ungenerated edge or queued
            // state can yield a cheaper path. This is not greedy goal guidance.
            if (key === destinationKey && distance <= entry.priority) return result(next);
            if (key === destinationKey) { incumbent = next; continue; }
            best.set(key, next);
            queue.push({type: 'node', node: next}, distance + h, -distance,next.guide);
        }
        if (++task.index < task.edits.length && task.edits[task.index].bound < ceiling()) queue.push(task, task.edits[task.index].bound, -node.distance - task.edits[task.index].edit.cost,node.guide);
    }
    if (incumbent) return result(incumbent);
    // Every atomic grammar has a finite remove-to-empty/build-from-empty path.
    // If pruning excluded all remaining nodes, their lower bound reached cutoff.
    if (Number.isFinite(cutoff)) return result(initial, true);
    throw new Error('The configured SQL-edit graph does not connect the supplied ASTs.');
}
