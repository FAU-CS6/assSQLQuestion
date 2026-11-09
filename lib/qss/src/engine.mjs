import {Unsupported, syntaxTree} from './syntax.mjs';
import {prepareTree, subtreeDistance} from './tree-distance.mjs';
import {originalQuery, originalSchema, originalDistance, originalConfig} from './original.mjs';

export const VERSION = '1.0.0';
export const SYNTAX_ENGINE = 'sqlite-syntax-edit-graph-v1';
export const ORIGINAL_ENGINE = 'graph-qss-original-v1';
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
class Cancelled extends Error {}
function context(onProgress, signal) {
    return {
        phase: 'parsing', visited: 0, frontier: 0, lowerBound: 0, untilYield: 0,
        async tick() {
            if (signal?.aborted) throw new Cancelled();
            ++this.visited;
            if (++this.untilYield < 512) return;
            this.untilYield = 0;
            onProgress?.({phase: this.phase, visited: this.visited, frontier: this.frontier, lowerBound: this.lowerBound});
            await yieldTask();
            if (signal?.aborted) throw new Cancelled();
        }
    };
}
const round = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
const syntaxLimitations = [
    'This is a SQLite syntax subtree edit graph extension, not the original semantic Graph-based QSS metric.',
    'Exactness is restricted to node relabeling and whole-child-subtree insertion/deletion; arbitrary subtree reparenting is excluded.',
    'Only explicitly supported equivalences are normalized; a positive distance does not prove SQL inequivalence.',
    'Client-computed results are shadow evidence and are not cryptographically authoritative grades.'
];
const rubricLimitation = 'Provisional, unvalidated shadow rubric: normalizationDistance = min(empty-answer referenceDistance, 5). One unit edit removes at least 20% of maximum points. This has not been validated against human grading.';

/** All parsing and graph computation is local to the calling browser/Worker. */
export async function evaluate(request, onProgress, {signal} = {}) {
    const engine = request?.engine || SYNTAX_ENGINE;
    const maxPoints = Number(request?.maxPoints ?? 1);
    const base = {engine, version: VERSION, maxPoints, distance: null, points: null, edits: [], exactWithinModel: false};
    const job = context(onProgress, signal);
    try {
        if (![SYNTAX_ENGINE, ORIGINAL_ENGINE].includes(engine)) throw new Unsupported('unknown-engine', 'Unknown explicit QSS engine model.');
        if (!Number.isFinite(maxPoints) || maxPoints < 0) throw new Unsupported('invalid-maximum', 'Maximum points must be a finite nonnegative number.');
        if (typeof request.reference !== 'string' || typeof request.answer !== 'string') throw new Unsupported('input-type', 'Reference and answer SQL must be strings.');
        if ((request.answerExecutionValid ?? request.executionValid) === false) throw new Unsupported('known-sql-execution-error', 'The browser SQLite run failed for this answer; no comparison score is certified.');
        if (signal?.aborted) throw new Cancelled();
        onProgress?.({phase: 'parsing', visited: 0, frontier: 0, lowerBound: 0});
        // A task boundary makes manual cancellation possible before parsing work starts.
        await yieldTask();
        const pointsPerEdit = request.pointsPerEdit == null ? null : Number(request.pointsPerEdit);
        if (pointsPerEdit !== null && (!Number.isFinite(pointsPerEdit) || pointsPerEdit <= 0)) throw new Unsupported('invalid-scale', 'Points per edit must be positive and finite.');
        const formula = pointsPerEdit === null ? 'maxPoints * max(0, 1 - distance / normalizationDistance)' : 'max(0, maxPoints - pointsPerEdit * distance)';
        let referenceDistance, normalizationDistance, result, validation, limitations;
        if (engine === SYNTAX_ENGINE) {
            const ref = syntaxTree(request.reference, {schema: request.schema, executionValid: request.referenceExecutionValid === true || request.executionValid === true});
            const ans = syntaxTree(request.answer, {schema: request.schema, executionValid: request.answerExecutionValid === true || request.executionValid === true, allowEmpty: true});
            const reference = prepareTree(ref.root), answer = prepareTree(ans.root);
            referenceDistance = reference.size;
            if (referenceDistance <= 0) throw new Unsupported('zero-baseline', 'The model has no positive edit cost.');
            normalizationDistance = Math.min(referenceDistance, 5);
            job.phase = 'syntax-edit-graph';
            const cutoff = request.exactDistance === true ? Infinity : pointsPerEdit === null ? normalizationDistance : Math.ceil(maxPoints / pointsPerEdit);
            result = await subtreeDistance(answer, reference, job, cutoff);
            validation = {reference: ref.validation, answer: ans.validation};
            limitations = [...syntaxLimitations];
            if ([ref.validation, ans.validation].includes('browser-sqlite-confirmed-cst')) limitations.push('A SQLite parser dialect gap was represented by the complete lossless syntax tree after browser SQLite execution confirmed validity.');
        } else {
            const reference = originalQuery(request.reference), answer = originalQuery(request.answer, true);
            const schema = originalSchema(reference, request.schema);
            try { reference.validateSemantics(schema); }
            catch { throw new Unsupported('original-semantics', 'The model exceeds the original prototype semantic validator; it may still be valid SQLite.'); }
            originalConfig(request.costs);
            limitations = [
                'Original Graph-based QSS prototype with a modern strict SQLite parser adapter, an isolated exact scheduler, and documented safety fixes.',
                'Only its restricted SELECT AST and configured atomic/horizontal/shortcut edits are supported.',
                'An optimal edit path is exact within that edit graph; it is not a proof of full SQLite semantic equivalence.',
                'Client-computed results are shadow evidence and are not cryptographically authoritative grades.'
            ];
            if (reference.equals(answer) && !request.costs) {
                return {...base, status: 'exact', distance: 0, points: round(maxPoints), referenceDistance: null,
                    normalizationDistance: null, provisionalRubric: true, rubric: 'provisional-cap-5-v1',
                    formula, pointsPerEdit, lowerBound: 0, exactWithinModel: true, scoreCertifiedWithinModel: true, visited: 1, validation: {reference: 'original-ast', answer: 'original-ast'},
                    limitations: [...limitations, rubricLimitation, 'The empty-answer baseline was not searched because identity already establishes full similarity.']};
            }
            referenceDistance = null;
            if (pointsPerEdit === null) {
                job.phase = 'original-reference-distance';
                const baseline = await originalDistance(reference, originalQuery('', true), schema, job, {costs: request.costs});
                referenceDistance = baseline.distance;
                if (referenceDistance <= 0) throw new Unsupported('zero-baseline', 'The original edit configuration gives the model a zero baseline cost.');
            }
            normalizationDistance = referenceDistance === null ? null : Math.min(referenceDistance, 5);
            job.phase = 'original-graph'; job.lowerBound = 0;
            const cutoff = request.exactDistance === true ? Infinity : pointsPerEdit === null ? normalizationDistance : Math.ceil(maxPoints / pointsPerEdit);
            result = await originalDistance(reference, answer, schema, job, {cutoff, costs: request.costs});
            validation = {reference: 'original-ast', answer: 'original-ast'};
        }
        if (signal?.aborted) throw new Cancelled();
        const points = pointsPerEdit === null ? maxPoints * Math.max(0, 1 - result.distance / normalizationDistance) : Math.max(0, maxPoints - pointsPerEdit * result.distance);
        return {...base, status: result.capped ? 'score-zero-certified' : 'exact',
            distance: result.capped ? null : result.distance, lowerBound: result.capped ? result.distance : result.distance,
            points: round(points), referenceDistance, normalizationDistance, pointsPerEdit, formula, edits: result.edits,
            provisionalRubric: true, rubric: pointsPerEdit === null ? 'provisional-cap-5-v1' : 'explicit-points-per-edit',
            exactWithinModel: !result.capped, scoreCertifiedWithinModel: true, visited: result.visited, validation, limitations: [...limitations, rubricLimitation]};
    } catch (error) {
        if (error instanceof Cancelled || signal?.aborted) return {...base, status: 'cancelled', limitations: ['Calculation was manually cancelled; no score is certified.']};
        if (error instanceof Unsupported) return {...base, status: 'unsupported', code: error.code, message: error.message,
            limitations: ['No substitution metric or zero grade was used for this unsupported input.']};
        return {...base, status: 'error', code: 'engine-error', message: error instanceof Error ? error.message : 'Unexpected QSS engine error.',
            limitations: ['The engine failed; no score is certified.']};
    }
}
