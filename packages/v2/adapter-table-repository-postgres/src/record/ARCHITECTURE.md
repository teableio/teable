Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-record-repository-postgres/src Architecture Notes

## Responsibilities

- Implement record-level persistence for Postgres (insert/update/delete).
- Provide query builders for stored/computed read paths.
- Host computed-field cascade update plumbing (planner + updater).
- Expose adapter-level DI wiring and entry points.

## Bulk mutation finalization

`CellValueMutateVisitor.finalize()` applies tracked last-modified fields and
returns the SET values, additional relation statements, and changed field IDs.
It does not compile a per-record UPDATE. `build()` is only for callers that
actually execute a single-record statement: it calls `finalize()` and adds the
compiled `mainUpdate`.

Batch and filter-based bulk updates must call `finalize()` directly. They build
their own set-based statement and must not pay for a per-record UPDATE that is
never executed. Both paths retain the same field order, explicit-null and
omitted-value semantics, generated-column handling, relation/attachment side
effects, changed-field propagation, and error precedence. Do not collapse the
two steps by reusing a mutable visitor instance across records or by caching
field metadata globally; each record still owns its tracked-field decisions.

## Opt-in pinyin ordering

Record and view sort items may request `collation: 'zh-pinyin'`. Validate field
eligibility and apply ICU collation to the text sort expression (the title for a
single-value Link), before pagination or range selection. Use the same ordering
for list reads, record-index lookups and range-based operations; do not reorder
an already paginated result. Omitted collation retains the existing SQL ordering.

The capability belongs to the actual data database serving the query. A missing
required ICU collation must produce an explicit request error, including on
embedded Postgres-compatible databases without ICU support. Do not substitute
the database default, `C` collation, transliteration, or client-side sorting.
Unsupported explicit field/collation combinations must also fail rather than be
ignored. The domain-level behavior contract is documented in the
[shared sort notes](../../../core/src/domain/shared/sort/ARCHITECTURE.md).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe module layout under src/.
- `computed/ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe computed update module scope.
- `computed/outbox/` - Role: outbox store; Purpose: persist computed update tasks for background workers.
- `computed/worker/` - Role: worker; Purpose: process computed update outbox tasks.
- `di/register.ts` - Role: DI helper; Purpose: register adapter services.
- `di/tokens.ts` - Role: DI tokens; Purpose: adapter token IDs.
- `query-builder/` - Role: query composition; Purpose: computed/stored SQL builders for record reads.
- `repository/` - Role: persistence; Purpose: Postgres repositories for records.
- `visitors/` - Role: value mappers; Purpose: field insert/update visitors.
- `index.ts` - Role: package entry; Purpose: export public adapter surface.
