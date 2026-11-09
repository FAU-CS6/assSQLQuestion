/** Exact search in an implicit, directed SQL-edit graph (paper sections 4.2–4.6). */
import {stableKey} from './graph-model.mjs';
import {symbolFacts, predicateFacts} from './graph-features.mjs';
export {symbolFacts, predicateFacts} from './graph-features.mjs';

class Heap {
    values = [];
    serial = 0;
    push(value, priority, tie = 0) {
        const entry = {value, priority, tie, serial: this.serial++}, a = this.values;
        a.push(entry); let i = a.length - 1;
        while (i) {
            const p = (i - 1) >> 1;
            if (this.compare(a[p], entry) <= 0) break;
            a[i] = a[p]; i = p;
        }
        a[i] = entry;
    }
    compare(a, b) { return a.priority - b.priority || a.tie - b.tie || a.serial - b.serial; }
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
    if (graph.edits.every(edit => edit.introducedComponent !== undefined)) {
        for (const edit of graph.edits) if (workComponents.has(edit.introducedComponent)) {
            componentRates.set(edit.introducedComponent, Math.min(componentRates.get(edit.introducedComponent) ?? Infinity, edit.cost));
        }
    }
    const charge = edit => [symbolUnit * (edit.maxNewSymbols || 0), distinctUnit * (edit.maxNewDistinct || 0),
        edit.statementOperation ? statementRates.get(edit.statementOperation + ':' + edit.statementKind) || 0 : 0,
        componentRates.get(edit.introducedComponent) || 0];
    const disjoint = graph.edits.every(edit => charge(edit).reduce((sum, cost) => sum + cost, 0) <= edit.cost);
    const combine = parts => disjoint ? parts.reduce((sum, cost) => sum + cost, 0) : Math.max(0, ...parts);
    const destinationStatements = statements(reference), destinationDistinct = distinctCount(reference), destinationComponents = componentCounts(reference);
    return {
        enabled: symbolUnit > 0 || distinctUnit > 0 || [...statementRates.values(), ...componentRates.values()].some(rate => rate > 0),
        decrease: edit => combine(charge(edit)),
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
    const destinationKey = stableKey(reference), startKey = stableKey(answer);
    const certificate = heuristicCertificate(graph.edits);
    const unit = useHeuristic && certificate.enabled ? certificate.unit : 0;
    const predicateCertificate = heuristicCertificate(graph.edits, 'maxNewPredicates');
    const predicateUnit = useHeuristic && predicateCertificate.enabled ? predicateCertificate.unit : 0;
    const work = useHeuristic ? sqlWorkBound(reference, graph, unit) : {measure: () => 0, decrease: () => 0};
    const facts = symbolFacts(reference), predicates = predicateFacts(reference);
    const heuristic = root => {
        const symbols = unit ? missingSymbols(root, facts) * unit : 0;
        const present = predicateUnit ? predicateFacts(root) : null;
        let missing = 0;
        if (present) for (const fact of predicates) if (!present.has(fact)) ++missing;
        // Predicate/binding changes can affect many signatures in one paid
        // edit. Only their presence/absence yields a certified one-edit bound.
        return {budget: work.measure(root, symbols), predicates: missing ? predicateUnit : 0};
    };
    const queue = new Heap(), best = new Map(), expanded = new Map();
    let settled = 0, generated = 1;
    const startBound = heuristic(answer);
    const initial = {root: answer, key: startKey, distance: 0, bounds: startBound,
        h: Math.max(startBound.budget, startBound.predicates), previous: null, edge: null};
    best.set(startKey, initial);
    queue.push({type: 'node', node: initial}, initial.h);
    const trace = node => {
        const result = [];
        for (let n = node; n.previous; n = n.previous) result.push(n.edge);
        return result.reverse();
    };
    const result = (node, capped = false) => ({
        distance: capped ? cutoff : node.distance, edits: capped ? [] : trace(node), capped,
        visited: settled, generated, frontier: queue.length,
        search: unit || predicateUnit || work.enabled ? 'exact-lazy-a-star' : 'exact-lazy-uniform-cost',
        heuristic: unit || predicateUnit || work.enabled ? 'admissible-sql-work-and-expression-bounds-v1' : 'zero',
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
                    bounds: {budget: 0, predicates: 0}, previous: initial,
                    edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
                        path: neighbour.operation?.path || [], operation: neighbour.operation}};
                return {...result(next), frontier: 0,
                    search: 'exact-direct-bound-certificate', heuristic: 'matching-global-start-lower-bound'};
            }
        }
    }
    while (queue.length) {
        const entry = queue.pop(), task = entry.value, node = task.node;
        if (best.get(node.key) !== node) continue;
        context.frontier = queue.length + 1;
        context.lowerBound = entry.priority;
        await context.tick();
        if (entry.priority >= cutoff) return result(node, true);
        if (task.type === 'node') {
            if (expanded.has(node.key) && expanded.get(node.key) <= node.distance) continue;
            expanded.set(node.key, node.distance); ++settled; context.visited = settled;
            if (node.key === destinationKey) return result(node);
            // Lower bounds on each not-yet-generated edit's neighbours. This is
            // the paper's lazy generation extended to an admissible heuristic.
            const edits = graph.edits.map(edit => ({edit,
                bound: node.distance + edit.cost + Math.max(0,
                    node.bounds.budget - work.decrease(edit),
                    node.bounds.predicates - (edit.maxNewPredicates || 0) * predicateUnit)
            })).sort((a, b) => a.bound - b.bound || b.edit.cost - a.edit.cost || editOrder(a.edit) - editOrder(b.edit));
            if (edits.length) queue.push({type: 'edit', node, edits, index: 0}, edits[0].bound, -node.distance - edits[0].edit.cost);
            continue;
        }
        const {edit} = task.edits[task.index];
        if (!Number.isSafeInteger(node.distance + edit.cost)) throw new RangeError('The SQL-edit path exceeds exact integer distance precision.');
        for (const neighbour of edit.apply(node.root)) {
            await context.tick();
            ++generated;
            const key = stableKey(neighbour.root), distance = node.distance + edit.cost;
            if (best.has(key) && best.get(key).distance <= distance) continue;
            const bounds = heuristic(neighbour.root), h = Math.max(bounds.budget, bounds.predicates);
            if (distance + h >= cutoff) continue;
            const next = {root: neighbour.root, key, distance, h, bounds, previous: node,
                edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
                    path: neighbour.operation?.path || [], operation: neighbour.operation}};
            // This task was the smallest lower bound in the entire queue. If a
            // generated goal attains that bound, no ungenerated edge or queued
            // state can yield a cheaper path. This is not greedy goal guidance.
            if (key === destinationKey && distance <= entry.priority) return result(next);
            best.set(key, next);
            queue.push({type: 'node', node: next}, distance + h, -distance);
        }
        if (++task.index < task.edits.length) queue.push(task, task.edits[task.index].bound, -node.distance - task.edits[task.index].edit.cost);
    }
    // Every atomic grammar has a finite remove-to-empty/build-from-empty path.
    // If pruning excluded all remaining nodes, their lower bound reached cutoff.
    if (Number.isFinite(cutoff)) return result(initial, true);
    throw new Error('The configured SQL-edit graph does not connect the supplied ASTs.');
}
