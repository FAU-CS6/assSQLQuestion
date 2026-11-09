# Browser QSS shadow engines

All SQL parsing, normalization and graph distance calculation runs in the browser
Worker. This directory starts no service and contains no server-side SQL/QSS
executor. The host application may store a result, but must treat browser results
as untrusted shadow evidence rather than authoritative grades.

## Explicit models

* `sqlite-syntax-edit-graph-v1` is the default **extension**, not the original
  semantic Graph-based QSS metric. A strict SQLite lexer preserves literals,
  identifiers, statement boundaries and parentheses. The SQLite parser supplies
  conservative AST normalization; its output is used only when an immutable AST
  round trip preserves all semantic fields. Lezer supplies the complete concrete
  syntax tree, with explicit statement/clause/group/identifier structure.
* `graph-qss-original-v1` uses the upstream Query AST, MetaInfo, and atomic,
  horizontal and shortcut edits. A new isolated lazy uniform-cost scheduler uses
  a priority heap, checks nonnegative safe integer costs, avoids numeric cost-gap
  scans, and includes table identities in visited buckets. It supports only the
  original restricted single SELECT edit model. It is available explicitly;
  the default model never silently runs or substitutes it.

The default extension's exact graph operations are node-label replacement and
whole-child-subtree insertion/deletion, preserving ordered child alignment.
Children cannot be freely promoted or reparented. A dynamic program computes the
shortest path **inside this specified restricted model**, with a trace of edits.
This is not token Levenshtein and not a claim of complete semantic SQL distance.

Weights: SQL keywords and operators cost 2, ordinary syntax/identifier/literal
nodes cost 1, and Script/CompositeIdentifier container labels cost 0. Whole-subtree
insertion/deletion costs the sum of its node weights. Relabeling costs the larger
of the two node weights. Statement order and parentheses remain represented.

Supported conservative normalizations include comments/whitespace, keyword case,
SQLite ASCII-only identifier case, consistently bound table aliases with distinct
correlated-query scopes, pure deterministic AND ordering, mirrored column/literal
comparisons, `<>`/negated `=`, and pure INNER JOIN to WHERE for explicit projections.
String case, non-ASCII identifier case, CAST types, explicit collations, outer
joins and ambiguous double-quoted string fallback are retained. Unproved cases
remain distinct; positive distance does not prove semantic inequivalence.

## API

The generated `qss.js` exposes `QSS.evaluate(request, onProgress, {signal})`.
`worker.qss.js` accepts:

```js
worker.postMessage({
    type: 'evaluate', id: 'request-1',
    reference: 'SELECT id FROM items', answer: 'SELECT value FROM items',
    maxPoints: 2,
    schema: {tables: [{name: 'items', columns: [{name: 'id', type: 'INTEGER'}]}]},
    referenceExecutionValid: true, answerExecutionValid: true
});
```

`schema` is optional. The application should supply actual SQLite schema metadata
from its existing SQL Worker. `schemaSql` may accompany the request for host
snapshot binding; this engine does not execute or infer a full schema from that
preparation script. Missing schema restricts reliable binding normalization,
especially for unqualified columns in correlated subqueries.

Progress messages are `{type:'progress', id, phase, visited, frontier, lowerBound}`.
They are work counters, not percentages or completion-time predictions. Results
are `{type:'result', id, result}` with explicit `engine`, `version`, `status`,
`distance`, `points`, `maxPoints`, `referenceDistance`, `normalizationDistance`,
`formula`, `edits`, `validation`, `limitations`, and exactness/certification flags.

The supported statuses are:

* `exact`: shortest distance inside the named model, including an edit trace.
* `score-zero-certified`: the score threshold is proven reached, but the exact
  distance is intentionally uncomputed (`distance:null`, certified `lowerBound`).
* `unsupported`, `error`, `cancelled`: no certified score (`points:null`).

An explicitly failed browser SQLite answer execution (`answerExecutionValid:false`)
is reported as `unsupported`, code `known-sql-execution-error`, with no certified
comparison score. This pilot does not yet model name/type/runtime-error edits for
partial grading of invalid answers. An absent execution flag still permits strict
parser-based analysis; a flag never overrides malformed lexical structure.

If the strict SQLite AST parser has a dialect gap, the extension accepts its
lossless, balanced CST only when successful browser SQLite execution is explicitly
confirmed for that input. It discloses `browser-sqlite-confirmed-cst`. Unterminated
quotes/comments, unbalanced parentheses, and actual Lezer recovery are rejected
even with a confirmation flag. This is no automatic metric fallback.

Manual cancellation uses `worker.postMessage({type:'cancel',id})` or immediate
termination of the owned Worker. No execution timeout, node budget, or elapsed-time
stop is configured. Jobs have independent cancellation state. Cooperatively
yielding task boundaries keep progress/cancel messages responsive; a single
upstream edit can still run synchronously until completion, so termination remains
the immediate manual-abort mechanism. Resume/checkpoint persistence is not supplied.

## Provisional shadow rubric

`referenceDistance` is the model's cost for an empty answer. The default rubric is:

```text
normalizationDistance = min(referenceDistance, 5)
points = maxPoints * max(0, 1 - distance / normalizationDistance)
```

Points are rounded to four decimal places. Thus a unit material edit removes at
least 20% of maximum points; long SQL boilerplate cannot dilute that penalty.
`provisionalRubric:true` and `rubric:'provisional-cap-5-v1'` explicitly identify this
calibration start. It has not been validated against human grading. An explicit
`pointsPerEdit` option is available for local comparison experiments, with its
different formula reported. The UI should show one clearly labeled shadow score.

The default search may stop at the mathematical zero-point threshold. This is a
distance certificate, never a time timeout. `exactDistance:true` requests the full
distance/trace, useful for comparing rubrics without another search. Original-model
identity does not search its expensive empty-answer baseline: distance0 already
establishes maximum similarity, and the unused baseline is reported as `null`.

## Reproducible build and verification

Node 24 is required (the working runtime was Node 24.22.2). Dependencies and build
tools are pinned in `package.json` and `package-lock.json`; no install scripts are
required.

```sh
cd lib/qss
npm ci --ignore-scripts
npm run build
npm run build:check
npm test
npm audit --audit-level=low
```

The build uses Node's TypeScript transform for the vendored source and Rollup.
The original circular AST-module dependencies are expected; the generated worker
is self-contained and needs neither DOM access nor a Node runtime. The small
package resolver avoids bringing an object-merging dependency into the build.

`build:check` rebuilds in a clean temporary source directory and verifies both
committed browser bundles byte-for-byte. The engine tests use only anonymous SQL
fixtures. The separate corpus acceptance runner receives private exports at
runtime; they are never part of this directory or the committed tests.

## Upstream and licenses

Verified source commit:
[`85685dd9513f8a25c140dabd50b6b0b0640ed7df`](https://github.com/FAU-CS6/sql-query-distance/tree/85685dd9513f8a25c140dabd50b6b0b0640ed7df).
`upstream/original/` preserves the unmodified source; `upstream/SOURCE.json` records
each original SHA-256. `upstream/sql-query-distance/` contains the documented
adapted runtime source and complete AGPL-3.0 license. Other bundled package notices
are in `THIRD-PARTY-NOTICES.md`. The complete modified source is distributed beside
the generated bundles.
