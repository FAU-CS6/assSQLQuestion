import {Unsupported} from './syntax.mjs';
import {parseGraphSql, stableKey} from './graph-model.mjs';
import {createEditGraph, replayOperation} from './graph-edits.mjs';
import {shortestSqlEditPath} from './graph-search.mjs';
import {originalQuery, originalSchema, originalDistance, originalConfig} from './original.mjs';
import {questionRequirements,requirementState} from './requirements.mjs';

export const VERSION = '2.1.1';
export const GRAPH_ENGINE = 'graph-qss-sqlite-v2';
export const ORIGINAL_ENGINE = 'graph-qss-original-v1';
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
class Cancelled extends Error {}
function context(onProgress, signal) {
    return {
        phase: 'parsing', visited: 0, frontier: 0, lowerBound: 0, work: 0,
        async tick() {
            if (signal?.aborted) throw new Cancelled();
            if (++this.work % 256 !== 0) return;
            onProgress?.({phase: this.phase, visited: this.visited, frontier: this.frontier, lowerBound: this.lowerBound});
            await yieldTask();
            if (signal?.aborted) throw new Cancelled();
        }
    };
}
const round = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
const limitations = [
    'Graph-based QSS following sections 4.2–4.7 of Köberlein et al.; the SQLite AST and edit catalogue extend the SELECT prototype.',
    'The shortest directed SQL-edit path is exact within the declared fixed edit catalogue, finite symbol domain and AST bounds; it does not decide complete SQL equivalence.',
    'A positive distance can reflect an equivalence absent from the current edit catalogue.',
    'Edit costs and the constant linear scale are provisional and have not been calibrated against independently human-graded student submissions.',
    'Browser-computed shadow results are untrusted evidence, not authoritative grades.'
];

/** SQL analysis, neighbour generation and shortest-path search run only locally. */
export async function evaluate(request, onProgress, {signal} = {}) {
    const engine = request?.engine || GRAPH_ENGINE;
    const maxPoints = Number(request?.maxPoints ?? 1);
    const scale = Number(request?.scale ?? request?.pointsPerEdit ?? (maxPoints>0?maxPoints/5:1));
    const base = {engine, version: VERSION, modelVersion: VERSION, maxPoints, scale, distance: null, points: null,
        edits: [], exactWithinModel: false, provisionalRubric: true, rubric: 'paper-linear-v2',
        formula: 'max(maxPoints - distance * scale, 0)', referenceDistance: null, normalizationDistance: null};
    const job = context(onProgress, signal);
    try {
        if (![GRAPH_ENGINE, ORIGINAL_ENGINE].includes(engine)) throw new Unsupported('unknown-engine', 'Unknown QSS model; the former syntax-tree distance has been removed.');
        if (!Number.isFinite(maxPoints) || maxPoints < 0) throw new Unsupported('invalid-maximum', 'Maximum points must be finite and nonnegative.');
        if (!Number.isFinite(scale) || scale <= 0) throw new Unsupported('invalid-scale', 'The constant linear grading scale must be positive and finite.');
        if (typeof request.reference !== 'string' || typeof request.answer !== 'string') throw new Unsupported('input-type', 'Reference and answer SQL must be strings.');
        if (signal?.aborted) throw new Cancelled();
        onProgress?.({phase: 'parsing', visited: 0, frontier: 0, lowerBound: 0});
        await yieldTask();
        // Runtime errors in student B or the independent control C do not reject
        // a representable SQL AST: paper section4.3.2 explicitly permits it.
        let result, validation;
        const cutoff = request.exactDistance === true ? Infinity : maxPoints / scale;
        if (engine === GRAPH_ENGINE) {
            const reference = parseGraphSql(request.reference, {schema: request.schema});
            const answer = parseGraphSql(request.answer, {schema: request.schema, allowEmpty: true});
            validation = {reference: reference.validation, answer: answer.validation};
            let requirements=questionRequirements(request.questionText);
            if(requirements.freeDiagnostics){
                const shapeVerified=request.referenceExecutionValid===true&&request.answerExecutionValid===true
                    &&Number.isSafeInteger(request.referenceRows)&&request.referenceRows>0&&request.answerRows===request.referenceRows;
                requirements={...requirements,freeDiagnostics:shapeVerified,freeLabels:shapeVerified?requirements.freeLabels:[]};
            }
            const graph = createEditGraph(reference.root, answer.root, request.schema, request.costs, requirements);
            base.requirements=requirements;
            job.phase = 'sql-edit-graph';
            result = await shortestSqlEditPath(reference.root, answer.root, graph, job,
                {cutoff: stableKey(reference.root) === stableKey(answer.root) ? Infinity : cutoff,
                    useHeuristic: request.useHeuristic !== false});
            if (!result.capped) {
                let replay = answer.root;
                for (const edit of result.edits) replay = replayOperation(replay, edit.operation);
                if (stableKey(replay) !== stableKey(reference.root)) throw new Error('The SQL-edit trace does not replay to the reference AST.');
            }
        } else {
            const reference = originalQuery(request.reference), answer = originalQuery(request.answer, true);
            const schema = originalSchema(reference, request.schema);
            try { reference.validateSemantics(schema); }
            catch { throw new Unsupported('original-semantics', 'The reference exceeds the original SELECT prototype semantic model.'); }
            originalConfig(request.costs);
            job.phase = 'original-graph';
            result = await originalDistance(reference, answer, schema, job, {cutoff, costs: request.costs});
            validation = {reference: 'original-ast', answer: 'original-ast'};
        }
        if (signal?.aborted) throw new Cancelled();
        const points = Math.min(maxPoints,round(Math.max(maxPoints - result.distance * scale, 0)));
        const costSum = result.edits.reduce((sum, edit) => sum + edit.cost, 0);
        if (!result.capped && Math.abs(costSum - result.distance) > 1e-8) throw new Error('The returned path cost does not equal its distance.');
        return {...base, status: result.capped ? 'score-zero-certified' : 'exact',
            distance: result.capped ? null : result.distance, lowerBound: result.distance,
            points, edits: result.edits, exactWithinModel: !result.capped,
            scoreCertifiedWithinModel: true, visited: result.visited,
            search: result.search || 'exact-lazy-uniform-cost', heuristic: result.heuristic || 'zero',
            limits: result.limits, validation, traceVerified: engine === GRAPH_ENGINE && !result.capped,
            limitations: engine === GRAPH_ENGINE ? limitations : [...limitations,
                'Explicit original SELECT prototype model; its restricted SQL support is unchanged.']};
    } catch (error) {
        if (error instanceof Cancelled || signal?.aborted) return {...base, status: 'cancelled', limitations: ['Manually cancelled; no score is certified.']};
        if (error instanceof Unsupported) return {...base, status: 'unsupported', code: error.code, message: error.message,
            limitations: ['This input is not representable by the SQL AST adapter; no syntax/string distance or zero grade was substituted.']};
        return {...base, status: 'error', code: 'engine-error', message: error instanceof Error ? error.message : 'Unexpected QSS engine error.',
            limitations: ['The graph calculation failed; no score is certified.']};
    }
}
