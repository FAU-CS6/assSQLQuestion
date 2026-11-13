import {stableKey} from './graph-model.mjs';
import {replayOperation} from './graph-edits.mjs';
import {createStructuralGuide} from './graph-guide.mjs';

/** Optional constructive zero-distance certificate for a directed edit graph.
 * A decreasing guide walks OUTGOING edges from the reference. This is not a
 * traversal of the reverse graph: every returned edge is separately generated
 * in the real answer-to-reference direction and replayed. In particular, a
 * named equivalence need not have a single-edge inverse for every spelling.
 *
 * Failure returns edges:null; the caller must retain its complete search.
 * The guide never supplies a lower bound, a grade, or a graph restriction.
 */
export async function findReverseZeroWitness(reference, answer, graph, context,
    {guide = createStructuralGuide()} = {}) {
    const key = graph.key || stableKey, startKey = key(answer), targetKey = key(reference);
    const result = {edges: null, generated: 0, passes: 0};
    if (graph.edits.some(edit => !Number.isSafeInteger(edit.cost) || edit.cost < 0)) return result;
    if (startKey === targetKey) return {...result, edges: []};
    const free = graph.edits.filter(edit => edit.cost === 0);
    if (!free.length) return result;
    const rank = (root, weighted) => {
        const value = guide(root, answer, weighted);
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    };
    const costMatches = edge => edge.operation && (edge.operation.cost == null || edge.operation.cost === 0);
    const forwardEdge = async (from, to) => {
        const destination = key(to);
        for (const edit of free) {
            await context.tick();
            for (const edge of edit.apply(from)) {
                await context.tick(); ++result.generated;
                if (!costMatches(edge) || key(edge.root) !== destination) continue;
                try {
                    const replay = replayOperation(from, edge.operation);
                    if (key(replay) !== destination || stableKey(replay) !== stableKey(edge.root)) continue;
                } catch { continue; }
                return {root: edge.root, name: edit.name, description: edit.description, cost: 0, operation: edge.operation};
            }
        }
        return null;
    };
    const certify = async nodes => {
        const meeting = nodes.at(-1), edges = [];
        if (key(meeting) !== startKey) {
            const bridge = await forwardEdge(answer, meeting);
            if (!bridge) return null;
            edges.push(bridge);
        }
        for (let i = nodes.length - 1; i > 0; i--) {
            const edge = await forwardEdge(nodes[i], nodes[i - 1]);
            if (!edge) return null;
            edges.push(edge);
        }
        // Recheck the whole forward trace, including a bridge whose concrete
        // node may have been generated independently of the backward walk.
        try {
            let replay = answer;
            for (const edge of edges) replay = replayOperation(replay, edge.operation);
            return key(replay) === targetKey ? edges : null;
        } catch { return null; }
    };
    // Four deterministic scheduling choices, not a node/time/depth budget.
    // Each walk retains one path and strictly decreases a nonnegative integer;
    // it therefore terminates without an execution limit. Equal-rank ties can
    // differ in reversibility (e.g. != versus <> before folding a NOT IN list).
    for (const weighted of [true, false]) for (const preferLast of [true, false]) {
        ++result.passes;
        const nodes = [reference];
        let current = reference, score = rank(current, weighted);
        if (score === null) continue;
        while (score > 0 && key(current) !== startKey) {
            let chosen = null, nextScore = score;
            for (const edit of free) {
                await context.tick();
                for (const edge of edit.apply(current)) {
                    await context.tick(); ++result.generated;
                    if (!costMatches(edge)) continue;
                    const candidate = rank(edge.root, weighted);
                    if (candidate === null || candidate >= score || candidate > nextScore
                        || candidate === nextScore && !preferLast) continue;
                    chosen = edge.root; nextScore = candidate;
                }
            }
            if (!chosen) break;
            nodes.push(chosen); current = chosen; score = nextScore;
        }
        const edges = await certify(nodes);
        if (edges) return {...result, edges};
    }
    return result;
}
