# Browser Graph-based QSS

All SQL parsing, SQL-edit generation and shortest-path calculation runs in a
browser Worker. There is no server-side SQL/QSS executor and no Node service.
The host may store the result as untrusted shadow evidence; regular ILIAS grades
continue to use the established metrics.

## Method and model

The default `graph-qss-sqlite-v2` follows sections 4.2–4.7 of
[Graph-based QSS by Köberlein, Probst and Lenz](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf).
It extends the prototype's SQL coverage through a new SQLite AST adapter and SQL
edit catalogue. It does not use the former syntax-tree distance.

* A state is a concrete semantic SQL AST. Statement, clause, expression and
  attribute roles remain distinct. Missing components and unset attributes are
  allowed, including the argument hole in `AVG()` and unresolved column names.
* Each named SQL edit has a fixed nonnegative integer cost. Its neighbour
  function applies at every compatible position, not only positions that differ
  from the target. Constructors add shallow components with holes or intrinsic
  leaves; they do not insert complete reference subtrees in one step.
* Atomic additions/removals and attribute changes connect states. Semantic
  shortcuts provide cheaper logical changes. Equivalence edits are actual
  zero-cost edges at intermediate states, including guarded alias renaming,
  Boolean commutation/association/idempotence in both directions, inequality
  rewrites, safe column/literal mirrors and INNER JOIN/WHERE relocation. The last
  preserves FROM source order, including for `SELECT *`, and excludes USING and
  NATURAL joins. Outer JOIN, volatile expressions and unproved collation changes
  do not receive those free equivalences; paid repair edits remain possible.
* Search proceeds from the student AST towards the reference AST. Exact lazy A*
  uses admissible lower bounds; without their certificate it uses uniform-cost
  search. These bounds affect scheduling, not the permitted neighbours. A
  completed path is replayed to the reference and its cost is checked.

A witnessed direct or multi-edit path can certify the optimum before the full
search when its cost equals the certified global lower bound at the initial AST.
An actual all-zero path is also optimal under nonnegative costs. These return
`exact-direct-bound-certificate`, `exact-witness-bound-certificate` or
`exact-zero-path-certificate`. Structural guides only schedule attempts to find
these witnesses; they never supply a distance, prune the graph or grade an answer.
An unsuccessful witness attempt falls through to the complete lazy search.

AST identity ignores representation-only empty fields (missing/null slots,
empty lists and an unset DISTINCT flag). It does not merge semantically equivalent
queries into one node. In particular, alias changes and predicate transformations
must be justified by graph edges.

### Finite configured graph

The edit catalogue uses finite value/constructor domains obtained from both input
ASTs and the supplied schema. Structural bounds are returned in `limits`: node
count, depth, list length and Boolean height. They allow temporary constructions
and reverse equivalence growth. They are derived from the inputs and bound the
configured graph; they are neither an elapsed-time timeout nor a visited-node
budget.

An optimal result is exact **within that catalogue, symbol domain and declared
AST bounds**. No optimality for an unbounded SQL graph or complete SQL-equivalence
decision is claimed. An unimplemented equivalence may still have positive
cost. Large zero-cost closures can remain expensive even in this finite graph.

### Explicit prototype diagnostic

`graph-qss-original-v1` remains available through the explicit `engine` argument.
It retains the upstream Query AST and atomic/horizontal/shortcut edits, with a
strict parser adapter and isolated heap scheduler. Its restricted single-SELECT
coverage is not a fallback for the default engine. It uses the same linear score
mapping below.

The previous `sqlite-syntax-edit-graph-v1` and its Cap-5 score are no longer
accepted assessment models. The [9 November report](../../docs/qss-abnahme-2026-11-09.md)
records that historical syntax experiment; it is not acceptance evidence for the
current Graph-based QSS engine. The
[graph acceptance report](../../docs/qss-graph-abnahme-2026-11-09.md) records
model 2.0.1. The [student-answer matrix report](../../docs/qss-studentenvarianten-2026-11-10.md)
confirms model 2.1.0 on all 699 original questions with 6,812 native Chrome cases,
saved grades and five pool round trips. It records variant-coverage gaps and the
limits of the provisional calibration.

## Provisional costs and linear grading

Default atomic/attribute and positive shortcut costs are 1. DISTINCT-related
changes cost 2. Adding/removing a whole script statement or a data source, and
changing its relation name, cost 5, reflecting a major logical step; an added
statement/source is still a shallow constructor. Supported
semantic equivalence edits cost 0. Costs are configurable by edit name through
`costs`, are fixed throughout a job, and must be nonnegative safe integers.

Positive SQL shortcuts include changing a literal/column/aggregate, wrapping an
expression, and `removeExtraneousBinaryTerm`: removing a binary operation while
retaining either operand costs 1. Thus an added `+ 1` can be removed as one
logical repair instead of paying for every syntax-tree node. This is a paid,
directed repair, not a zero-cost equivalence or a target-position restriction.

Other named local repairs restore one declared constraint, one non-query output
expression or a declared column with its quoted CHECK bindings. These logical
edits never insert a complete data query or subquery as one local repair.
Additional guarded zero-cost laws cover De Morgan/complement comparisons,
NULL-preserving Boolean CASE, exact int64 constant expressions, COUNT(*)/COUNT(1)
and single-column foreign-key layouts while retaining foreign-key action order.
Double-quoted names resolve against their SQLite scope, including ALTER ADD
CHECK and compound ORDER BY; DEFAULT retains its independent DQS context.

`questionText` supplies explicit construct requirements. They restrict free edits
only when the question states a method constraint. Explicitly unconstrained
Boolean group labels and a technical feedback tuple have question-relative
edits; they are not universal SQL equivalences. Feedback-tuple edits require
successful reference/answer runs and matching observed result-row counts.

The grading formula from paper section 4.7 is:

```text
points = max(maxPoints - distance * scale, 0)
```

The default `scale` is `maxPoints / 5` for a positive maximum (otherwise 1), fixed
throughout each question's comparison. A local cost of 1 deducts 20% of that
question's maximum; cost 5 exhausts it. An explicit API `scale` overrides the
default, and `pointsPerEdit` is its alias. Points are rounded to four decimals.
No empty-answer or syntax/tree-distance normalization is used.
`provisionalRubric:true` and `rubric:'paper-linear-v2'`
identify this implementation's provisional cost calibration. Neither these
particular costs nor the scale have been validated against independently
human-graded student answers.

A mathematical lower bound at `maxPoints / scale` certifies zero points and may
end the search without calculating the exact distance. This is not a timeout.
`exactDistance:true` requests the full distance and path instead.

## API

`qss.js` exposes `QSS.evaluate(request, onProgress, {signal})`.
`worker.qss.js` accepts:

```js
worker.postMessage({
    type: 'evaluate', id: 'request-1',
    engine: 'graph-qss-sqlite-v2',
    reference: 'SELECT id FROM items', answer: 'SELECT value FROM items',
    maxPoints: 2, // default scale: 0.4; explicit scale remains supported
    questionText: '', referenceExecutionValid: true, answerExecutionValid: true,
    referenceRows: 3, answerRows: 3,
    schema: {tables: [{name: 'items', type: 'table', columns: [{name: 'id', type: 'INTEGER'}]}]}
});
```

The application supplies actual SQLite schema metadata from its existing SQL
Worker. The static engine does not execute A, B or C. A failed student SQL run or
control C does not reject a representable answer AST. Unsupported grammar remains
explicitly `unsupported`; no string/CST distance is substituted. The reference
is expected to be an executable model solution.

Each schema object must include its SQLite `type` (`table` or `view`), not merely
its column types. A column can hide a volatile expression through a view, derived
source, CTE or matching SELECT alias. Free expression/JOIN laws reject those
opaque origins, while safe alias renaming remains available. Without object-type
metadata the engine cannot identify hidden view volatility; callers must supply
it for assessment. Unrelated function projections do not disable laws on known
base-column expressions.

Progress messages contain `{type:'progress', id, phase, visited, frontier,
lowerBound}`. These are search work counters and a mathematical lower bound, not
percentages or completion-time predictions. Results carry the engine/version,
status, distance, scale, points, formula, named edits, validation, limitations,
search method, structural limits and certification flags. Legacy fields
`referenceDistance` and `normalizationDistance` are unused and null.

Statuses:

* `exact`: shortest directed path within the declared model, with its edit trace.
* `score-zero-certified`: zero points proved; `distance:null` and a certified
  `lowerBound`, without a fabricated exact path.
* `unsupported`, `error`, `cancelled`: no certified score (`points:null`).

Manual cancellation uses `worker.postMessage({type:'cancel',id})` or immediate
termination of the owned Worker. Jobs have independent cancellation state.
Cooperative task boundaries keep progress/cancel messages responsive. Worker
termination is the immediate manual-abort mechanism. No execution timeout,
resume/checkpoint persistence or additional service is configured.

## Reproducible build and verification

Node 24 is required only for development/rebuilding. Dependencies and build tools
are pinned in `package.json` and `package-lock.json`; no install scripts are needed.

```sh
cd lib/qss
npm ci --ignore-scripts
npm run build
npm run build:check
npm test
npm audit --audit-level=low
```

Rollup builds self-contained browser bundles. The explicitly retained TypeScript
prototype uses Node's build-time transformer; ILIAS itself requires no Node runtime.
The local resolver avoids an additional object-merging build dependency.
`build:check` rebuilds in a clean temporary source directory and compares both
committed bundles byte-for-byte.

Unit/SQLite tests use anonymous fixtures, including the paper's missing-argument
and reverse-equivalence examples, directed edit costs, path replay and independent
semantic counterexamples. The separate corpus/browser runners receive private
exports at runtime. Their observations and credentials are not committed. A
successful parser/self-comparison is not evidence that arbitrary student answers
are fairly graded; the grading comparison requires its own recorded runs.

### Private corpus acceptance

Private exports, credentials, SQL observations and browser screenshots remain
outside version control. The runners require an explicitly supplied installed
Google Chrome CDP endpoint and verify headless operation.

* `tests/browser/qss-corpus.cjs` executes the original answer, safe formatting and
  a reproducible adverse answer for each source question. `QSS_CORPUS_START` is a
  zero-based offset and `QSS_CORPUS_LIMIT` is the number of source questions.
  SQL, QSS and legacy-metric timings are recorded separately.
* `tests/ilias11/pool-corpus.php exam` creates native test fixtures using
  `ILIAS_CORPUS_SOURCE_START` and `ILIAS_CORPUS_LIMIT`. Each fixture retains the
  exact source keys, original question IDs, ordinals and corpus digest.
  `tests/browser/pool-corpus.cjs` answers and finishes the declared native test
  as the ordinary student and checks the complete source range.
* `tests/qss/merge-corpus.cjs` merges completed Chrome ranges, checks all source
  identities and score certificates, and preserves input reports and their
  completion states. `tests/qss/replay-corpus.cjs` independently validates the
  resulting recorded cases without executing SQL or rewriting observations.
* `tests/ilias11/qss-report.php` reads saved answers, diagnostics and official
  grades after each native test. `tests/qss/verify-native-ranges.cjs` checks the
  union of native ranges, distinct source/original/native IDs, current bundles,
  browser observations and participant-finalized database grades.

The final 699-question proof uses disjoint ranges 1–175, 176–350, 351–525 and
526–699 for both browser paths. Create fixtures and run database reports
sequentially: ILIAS CLI authentication rewrites the CLI user's preferences.
Browser runs use separate private contexts. Neither runner imposes a SQL or QSS
execution deadline.

Both aggregate verifiers have anonymous `--self-test` modes that reject missing,
duplicate, mixed-build and unfinished evidence. These check the acceptance gates;
they are separate from the actual Chrome and grading tests.

`student-variants.cjs` and `student-variant-oracle.cjs` additionally exercise up
to four correct, three independently distinguished local errors and three gross
errors per source in the regular student form. Candidate transformation proofs
and an independent Chrome SQL worker select cases before QSS runs. Representation
variants are separately labelled; atomic questions may have fewer local errors
or substantively different correct strategies. The reports retain these gaps.
Selection prefers different local error families before testing more candidates
from a family already witnessed, and never depends on QSS points.

`tests/ilias11/student-variants-report.php` checks every captured case with the
unchanged official scorer, both with and without its QSS sidecar.
`tests/qss/verify-student-variants.cjs` joins all four completed native matrices,
original identities, immutable plans/build hashes, restored source outputs,
database grades and final teacher import/export/reimport semantic evidence.
Private observations are never included in this repository.

## Upstream and licenses

The retained prototype source was verified against upstream commit
[`85685dd9513f8a25c140dabd50b6b0b0640ed7df`](https://github.com/FAU-CS6/sql-query-distance/tree/85685dd9513f8a25c140dabd50b6b0b0640ed7df).
`upstream/original/` preserves the unmodified source; `upstream/SOURCE.json` records
its SHA-256 hashes. `upstream/sql-query-distance/` contains the documented adapted
prototype and complete AGPL-3.0 license. The new default engine and its full source
are distributed beside the bundles; no claim is made that its expanded catalogue
is byte-identical to the prototype. Other bundled notices are in
`THIRD-PARTY-NOTICES.md`.
