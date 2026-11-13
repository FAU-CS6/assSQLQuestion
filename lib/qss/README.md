# Browser Graph-based QSS

All SQL parsing, SQL-edit generation and shortest-path calculation runs in a
browser Worker. There is no server-side SQL/QSS executor and no Node service.
ILIAS question authors explicitly choose either result-based grading or QSS.
Only that method is evaluated. The host validates answer/revision bindings and
recomputes the linear points from the certified browser distance before storing
the official QSS score and its cost revision. Browser evidence remains untrusted
in the same sense as the existing browser-generated result metrics.

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
  from the target. Basic constructors add shallow components with holes or intrinsic
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
A witnessed path above the initial lower bound supplies an upper bound only;
the remaining search must still prove that no cheaper path exists.

All configured edge costs are integers, so a proven rational lower bound can be
rounded up to the next integer. Effect ratios and cost partitions use exact
BigInt arithmetic for this certificate; floating-point `Math.ceil` is not used.
The lazy edit schedule subtracts each exact per-edit decrease before rounding
the remaining bound. Thus a bound of 4.8 already excludes every path below
the five-cost score cutoff without changing an edge or inventing an exact path.
Task yields use short-lived browser MessageChannels instead of nested timers;
cancellation checks and the frequency of real task boundaries remain unchanged.

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
records model 2.1.0. The [answer-robustness report](../../docs/qss-robustheit-2026-11-10.md)
confirms model 2.1.1 with 6,812 fresh native Chrome cases on all 699 unchanged
questions, 132 additional anonymous semantic cases, saved grades and five pool
round trips. It records phase timings, variant-coverage gaps and calibration limits.

Model 2.1.1 caches immutable AST keys and structural metrics per graph job without
changing state equality or AST limits. A binary surplus-symbol lower bound is
enabled only when edit-effect declarations prove it admissible; free symbol-
changing overrides or unknown effects disable that certificate. Witness paths
still certify an optimum only by matching the global lower bound; otherwise
the complete lazy search runs.

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
The paid `relocateOuterJoinPredicate` edit also moves one pure conjunct between
ON and WHERE while retaining a joining predicate. Its default cost is 1; outer
join predicate relocation does not become a free equivalence.

Graph model 2.7.0 uses cost-profile version 7 with 71 configurable entries:
56 named SQL transformations/repairs and 15 basic operation categories.
Profiles from models 2.1.1, 2.2.0, 2.3.0, 2.4.0, 2.5.0, 2.6.0 and 2.6.1 retain all their previous overrides;
new entries receive their defaults. Stored grades retain their saved model,
scale and reference revision, including in the released solution view.
Known inactive steps are accepted independently of the current AST pair.
Patch 2.6.1 preserved all 64 then-existing costs and permitted the optional ADD COLUMN
edit when schema metadata is inspected: SQLite omits that keyword from stored
column definitions. Other metadata-sensitive DDL edits and EXPLAIN remain
guarded. Historical scores keep their saved model and are not recomputed.
Basic-operation category costs apply to the generated atomic edits; an explicit
pair-specific atomic `costs` API entry still takes precedence. See
[cost profiles](../../docs/qss-kostenkonfiguration.md) and
[native grading acceptance](../../docs/qss-bewertung.md).

Model 2.7.0 adds seven independently configurable directed edits. Existing
costs are unchanged; six additions default to 0 and one repair defaults to 1:

| Edit | Default | Guarded operation |
| --- | ---: | --- |
| `toggleJoinedProjectionAlias` | 0 | Add/remove the exact physical column name as an AS alias across known joined base tables, preserving output spelling and excluding duplicate names and ORDER/GROUP/HAVING bindings. |
| `toggleJoinedIdenticalTableAlias` | 0 | Add/remove a base-table alias identical to its table binding across known sources, without capture or implicit output-name changes. |
| `rewriteUniqueFilteredSemijoin` | 0 | Rewrite a positive IN subquery and INNER JOIN when a declared PK/UNIQUE key plus literal equality filters proves at most one matching inner row; comparison affinity and BINARY collation must agree. |
| `changeSubqueryComparison` | 1 | Replace IN/NOT IN around one subquery with a scalar comparison, or conversely, preserving the left operand and inner query. This is a semantic repair: multiple matches and NULL can change the result. |
| `qualifyLocalSubqueryColumn` | 0 | Add/remove the qualifier of a proved local physical column in a single-source, uncorrelated subquery. |
| `toggleLocalSubqueryTableAlias` | 0 | Add/remove an identical table-name alias in that proved local subquery scope. |
| `commuteInnerJoinSources` | 0 | Exchange two ordinary INNER JOIN sources with explicit unambiguous physical output columns, retaining the ON expression exactly. |

These rules require their individual scope, provenance, output-name and purity
guards. In particular, the semijoin rule excludes DISTINCT, aggregates, ordering,
limits, correlation and nested scopes, and retains duplicate outer rows and SQL
NULL behavior. The JOIN commutation rule excludes outer/USING/NATURAL joins,
wildcards, grouping, ordering, limits and volatile expressions. Unknown schema
or unproved bindings withhold the affected equivalence rather than assume it.
Every rule generates a concrete replayable AST edge; none replaces AST identity
with observed result equality. Costs 0, 1 and 7 are regression-tested, including
custom prices on otherwise free steps.

The existing `commuteBooleanOperands` step additionally accepts a proved
side-effect-free AND/OR expression containing exactly one uncorrelated subquery
in the outer WHERE of SELECT, UPDATE or DELETE. Actual ordinary-table metadata
and CREATE provenance are required. Functions, views, triggers, attached/TEMP
namespaces, unknown or captured columns, nested queries, CTEs, ordering, limits
and grouped subqueries are excluded. The subquery itself is not rewritten;
scalar first-row/empty-NULL and IN/NOT IN behavior stay inside the same operand.
This extends an existing guarded edit without adding an eighth price.

The matching search optimizations retain exact shortest paths within the
configured graph. Statement alignment and independently certified effect bounds
can exclude whole lazy edit families before allocating their neighbours.
Scalar fact views deliberately forget distinctions changed by free edits;
concrete keys, operations and replay keep those distinctions. Missing effect
certificates or free overrides disable the affected positive lower bound.
No search guide supplies an approximate distance, timeout or visited-node budget.
A cheap existing bound can reject a successor before expensive fact collection;
accepted states retain their full bounds and queue order. The semijoin fact
relaxation is omitted when the fixed schema provenance proves that no semijoin
edge can exist anywhere in the graph. A non-collapsing canonical OR is retained
even when semijoins are possible: neither endpoint of the guarded semijoin rule
contains that disjunction. Both tests concern search facts only, never AST identity.

The final native answer retest covers 33 unchanged answers on model 2.7.0:
30 QSS cases all complete with a certified result (23 exact paths and seven
zero-point certificates), while three legacy result cases retain their previous
behavior without starting QSS. UI elapsed time has a median of 754 ms and a
maximum of 4.035 s; QSS-worker time has a median of 91.8 ms and a maximum of
3.557 s. The custom-cost comparison finishes in 3.206 s of QSS work. These
measurements cover that regression matrix, not all possible SQL answers or
reference SQL execution times. The earlier 100 official random test attempts
retain their historical model versions and grades. See the dated
[assessment report](../../docs/qss-bewertung.md).

The final native author-form self-check also covers all 699 unchanged model
answers: 351 QSS answers return exact distance zero and full points, and 348
result-based answers run the established metrics successfully. Every question
fingerprint remains unchanged and only its selected evaluator runs. QSS time
has a median of 66.3 ms and a maximum of 173.2 ms. Original SQL execution can
take substantially longer; the longest observed SQL run takes 74.515 s.
These three disjoint browser ranges do not constitute another 100-attempt
student test or a general runtime bound.

The SQLite runtime remains the existing 3.22.0 browser build. The graph adapter
also represents its CTE/DML, transaction, trigger, FTS3/FTS4, index-hint, row
assignment, declaration-constraint and EXPLAIN syntax. Runtime features absent
from that build, such as window functions and FTS5, are not supplied by QSS.
This coverage does not claim a complete SQLite grammar or equivalence decision.

New guarded free edits cover BETWEEN, literal IN lists, proven SQLite DQS strings,
rowid-primary-key nullability, explicit parent-key lists, unambiguous single-table
qualification, redundant aliases and canonical integer/TEXT comparisons.
A separate configurable edge qualifies or unqualifies a WHERE column across
known ordinary joined tables when exactly one physical source owns the column.
It requires ordinary CREATE TABLE provenance and excludes virtual tables,
namespace changes, hidden row aliases, USING/NATURAL joins and nested scopes.
It does not rewrite projection names or move predicates between ON and WHERE.
Output-name flags, alias capture, schema metadata and affinity can invalidate an
apparent equivalence; the affected edges are withheld. Alias renaming preserves
implicit output names, including names used by outer queries. A missing binary
operand, a missing atomic NULL filter and a missing ORDER BY column have explicit paid repair steps, each
with default cost 1. These never insert a complete query or subquery.

Search optimizations intern immutable structural keys, share lazy edit schedules
and memoize scheduling guides per job. An optional guide walk from the reference
can construct a zero-cost witness when a forward guide stalls. It does not
assume that graph edges are reversible: every step, including a possible bridge
from the answer, must be generated in the actual forward direction and replayed.
A failed witness leaves the complete shortest-path search unchanged. The guide
never supplies a grade, lower bound or execution budget.
Coarse AST views are used exclusively for
admissible facts; graph keys and operation replays retain concrete distinctions.
The ordinary NOT NULL predicate bound remains distinct from the guarded free
INTEGER PRIMARY KEY rule. None of these optimizations introduces an execution
deadline, a visited-node budget or an approximate score.

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
npm --prefix ../../tests/browser ci --ignore-scripts --no-audit --no-fund
npm test
npm audit --audit-level=low
```

Rollup builds self-contained browser bundles. The explicitly retained TypeScript
prototype uses Node's build-time transformer; ILIAS itself requires no Node runtime.
The local resolver avoids an additional object-merging build dependency.
`build:check` rebuilds in a clean temporary source directory and compares both
committed bundles byte-for-byte.

`npm test` requires an installed Google Chrome. It launches a fresh headless
browser and runs the SQL/QSS test bodies with the shipped SQLite 3.22.0 asset.
Node only bundles the tests and runs four report/transport test files that do
not execute SQL or QSS. The same Rollup TypeScript resolution is used as in the
product build. Browser assertions use the strict API of the pinned `assert`
test dependency; SQL values are not compared through a lossy JSON substitute.
The limited SQLite test adapter preserves prepare errors and exact integer
reads; it does not replace or modify the deployed SQLite runtime.

The test runner has no execution deadline and writes individual results to
`test-results/qss/browser-tests.json` (or `QSS_TEST_REPORT_DIR`). Eight optional
CDP oracle groups remain separately declared skips in this suite, as before;
the real browser-worker cancellation test now runs here too. GitHub Actions
installs Chrome and the browser test dependencies before invoking this same
command, followed by bundle reproduction, dependency audit and UI checks.

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

The historical 699-question proof used disjoint ranges 1–175, 176–350, 351–525 and
526–699 for both browser paths. These commands describe that fixture workflow;
the current native 2.7.0 checks are recorded in the assessment report above.
Create fixtures and run database reports
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
