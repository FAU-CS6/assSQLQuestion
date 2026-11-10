/** Exact search in an implicit, directed SQL-edit graph (paper sections 4.2–4.6). */
import {stableKey as graphModelKey} from './graph-model.mjs';
import {symbolFacts, predicateFacts} from './graph-features.mjs';
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

/** Scheduling only, after the certified A* priority and path-cost tie.
 * No distance claim, pruning rule or target-position restriction uses this
 * value. Every edge remains available. It avoids breadth-first enumeration of
 * huge free Boolean closures when several zero-cost rewrites are needed.
 */
function structuralSize(value){
    if(value==null)return 0;
    if(Array.isArray(value))return value.reduce((n,v)=>n+structuralSize(v),0);
    if(typeof value==='object')return 1+Object.values(value).reduce((n,v)=>n+structuralSize(v),0);
    return 1;
}
function structuralTieDistance(a,b,weighted=true){
    if(a===b)return 0;
    if(a==null||b==null)return weighted?structuralSize(a==null?b:a):1;
    if(Array.isArray(a)||Array.isArray(b)){
        if(!Array.isArray(a)||!Array.isArray(b))return 1;
        let n=0;for(let i=0;i<Math.max(a.length,b.length);i++)n+=structuralTieDistance(a[i],b[i],weighted);return n;
    }
    if(typeof a!=='object'||typeof b!=='object')return a===b?0:1;
    let n=0;for(const key of new Set([...Object.keys(a),...Object.keys(b)]))n+=structuralTieDistance(a[key],b[key],weighted);return n;
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
    const stableKey = graph.key || graphModelKey;
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
    const destinationRelations=relationWork(reference);
    const work = useHeuristic ? sqlWorkBound(reference, graph, unit) : {measure: () => 0, decrease: () => 0};
    const abstract=root=>graph.abstractRoot?graph.abstractRoot(root):root;
    const facts = symbolFacts(abstract(reference)), predicates = predicateFacts(abstract(reference));
    const heuristic = root => {
        const normalized=abstract(root),have=unit||extraUnit?symbolFacts(normalized):null;
        const symbols = unit ? [...facts].filter(fact=>!have.has(fact)).length * unit : 0;
        const extraSymbols = extraUnit && [...have].some(fact => !facts.has(fact)) ? extraUnit : 0;
        const present = predicateUnit ? predicateFacts(normalized) : null;
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
        return {budget: work.measure(root, symbols), extraSymbols, predicates: missing ? predicateUnit : 0,
            relations:absentRelations*relationUnit,sources:Math.max(0,destinationRelations.sources-presentRelations.sources)*sourceUnit};
    };
    const maximumBound = bounds => Math.max(bounds.budget, bounds.extraSymbols, bounds.predicates, bounds.relations, bounds.sources);
    const remainingBound = (bounds, edit) => Math.max(0,
        bounds.budget - work.decrease(edit),
        bounds.extraSymbols - (edit.preservesSymbolSet === true ? 0 : extraUnit),
        bounds.predicates - (edit.maxNewPredicates || 0) * predicateUnit,
        bounds.relations - (edit.maxNewRelations || 0) * relationUnit,
        bounds.sources - (edit.maxNewSources || 0) * sourceUnit);
    const queue = new Heap(), best = new Map(), expanded = new Map();
    let settled = 0, generated = 1;
    const startBound = heuristic(answer);
    const initial = {root: answer, key: startKey, distance: 0, bounds: startBound,
        h: maximumBound(startBound), previous: null, edge: null};
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
        heuristic: unit || extraUnit || predicateUnit || work.enabled || relationUnit || sourceUnit ? 'admissible-sql-work-and-expression-bounds-v3' : 'zero',
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
    // Optional multi-edit upper witness. It may use a restricted, monotone
    // scheduling pass because it NEVER defines the graph or an approximate
    // grade. Only equality with the already certified GLOBAL lower bound can
    // return a result. Otherwise the complete search below is unchanged.
    if(Number.isSafeInteger(initial.h)&&initial.h>0&&initial.h<cutoff){
        const seen=new Map();
        const witness=async node=>{
            if(node.key===destinationKey)return node.distance===initial.h?node:null;
            const prior=seen.get(node.key);if(prior!==undefined&&prior<=node.distance)return null;seen.set(node.key,node.distance);
            const candidates=[];
            for(const edit of graph.edits){
                if(node.distance+edit.cost>initial.h)continue;
                if(node.distance+edit.cost+remainingBound(node.bounds,edit)>initial.h)continue;
                await context.tick();
                for(const edge of edit.apply(node.root)){
                    await context.tick();const guide=structuralTieDistance(edge.root,reference);
                    if(guide>=node.guide)continue;
                    const bounds=heuristic(edge.root),distance=node.distance+edit.cost;
                    if(distance+maximumBound(bounds)>initial.h)continue;
                    candidates.push({root:edge.root,key:stableKey(edge.root),distance,guide,bounds,previous:node,
                        edge:{type:'sql-edit',name:edit.name,description:edit.description,cost:edit.cost,path:edge.operation.path,operation:edge.operation}});++generated;
                }
            }
            candidates.sort((a,b)=>a.guide-b.guide||a.distance-b.distance);
            for(const next of candidates){const found=await witness(next);if(found)return found;}
            return null;
        };
        const found=await witness(initial);
        if(found)return{...result(found),frontier:0,search:'exact-witness-bound-certificate',heuristic:'matching-global-start-lower-bound'};
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
                bound: node.distance + edit.cost + remainingBound(node.bounds,edit)
            })).sort((a, b) => a.bound - b.bound || b.edit.cost - a.edit.cost || editOrder(a.edit) - editOrder(b.edit));
            if (edits.length) queue.push({type: 'edit', node, edits, index: 0}, edits[0].bound, -node.distance - edits[0].edit.cost,node.guide);
            continue;
        }
        const {edit} = task.edits[task.index];
        if (!Number.isSafeInteger(node.distance + edit.cost)) throw new RangeError('The SQL-edit path exceeds exact integer distance precision.');
        for (const neighbour of edit.apply(node.root)) {
            await context.tick();
            ++generated;
            const key = stableKey(neighbour.root), distance = node.distance + edit.cost;
            if (best.has(key) && best.get(key).distance <= distance) continue;
            const bounds = heuristic(neighbour.root), h = maximumBound(bounds);
            if (distance + h >= cutoff) continue;
            const next = {root: neighbour.root, key, distance, h, bounds,guide:structuralTieDistance(neighbour.root,reference), previous: node,
                edge: {type: 'sql-edit', name: edit.name, description: edit.description, cost: edit.cost,
                    path: neighbour.operation?.path || [], operation: neighbour.operation}};
            // This task was the smallest lower bound in the entire queue. If a
            // generated goal attains that bound, no ungenerated edge or queued
            // state can yield a cheaper path. This is not greedy goal guidance.
            if (key === destinationKey && distance <= entry.priority) return result(next);
            best.set(key, next);
            queue.push({type: 'node', node: next}, distance + h, -distance,next.guide);
        }
        if (++task.index < task.edits.length) queue.push(task, task.edits[task.index].bound, -node.distance - task.edits[task.index].edit.cost,node.guide);
    }
    // Every atomic grammar has a finite remove-to-empty/build-from-empty path.
    // If pruning excluded all remaining nodes, their lower bound reached cutoff.
    if (Number.isFinite(cutoff)) return result(initial, true);
    throw new Error('The configured SQL-edit graph does not connect the supplied ASTs.');
}
