# Upstream Graph-based QSS prototype

Source: https://github.com/FAU-CS6/sql-query-distance, commit
`85685dd9513f8a25c140dabd50b6b0b0640ed7df` (package version 1.0.0).
Every original source file was verified byte-for-byte against that commit.
An untouched copy is retained in `../original/`; `../SOURCE.json` records SHA-256 hashes. Copyright remains with the upstream authors, including
Leo Köberlein. The upstream AGPL-3.0 license is included verbatim in `LICENSE`.

The TypeScript AST, metadata and atomic/horizontal/shortcut edits are retained.
The browser runtime uses our strict parser adapter and isolated scheduler in
`../../src/`, rather than the prototype's global scheduler/parser.

Changes to upstream source:

* Type-only imports/exports are annotated for the Node 24 build transformer.
* Equality is not considered associative. SQL `(2=1)=0` and `2=(1=0)` differ.
* Cost-free FROM reordering is restricted to comma-separated tables and explicit
  projections; joins and `SELECT *` are excluded because reordering may change
  semantics or output column order.

The separate SQLite SQL-AST edit graph follows the paper's implicit-graph and
shortest-SQL-edit-path approach with an expanded AST and its own edit catalogue.
It is not the prototype's exact metric or the former syntax-tree alignment.
Full source is distributed here;
generated browser bundles are built from this source and the pinned lockfile.
