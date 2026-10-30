Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# adapter-schema-repository-postgres visitors Architecture Notes

## Responsibilities

- Translate domain fields/specs into Postgres DDL operations.
- Support table create (column list) and schema updates (add columns).
- **Delegate to the rules system** for actual DDL statement generation.

## Design

The visitors in this folder are now thin wrappers around the **rules system** (`../rules/`).

- **Create Visitor**: Calls `schemaRuleResolver.upAll(rules, ctx)` to generate ADD statements
- **Delete Visitor**: Calls `schemaRuleResolver.downAll(rules, ctx)` to generate DROP statements

This eliminates code duplication between create/delete logic and centralizes schema rule definitions.

Field duplication copies relationship storage separately from the link display column.
`LinkFieldValueDuplicateVisitor` copies junction pairs for `manyMany` and one-way `oneMany`.
Two-way `oneMany` reads its configured foreign FK host into a new one-way junction. Hosting
`manyOne`/`oneOne` copies the foreign key column, not `__id`; reverse `oneOne` joins the original
FK host into a new local FK. Every path preserves order when both fields carry an order column
and leaves the source relationship untouched.

The Nest regressions `test/field-duplicate-v2-reverse-one-many.e2e-spec.ts` and
`test/field-duplicate-v2-link-matrix.e2e-spec.ts` exercise the public duplicate route. The matrix
covers all six storage shapes across ten direction/configuration combinations, including both
sides of two-way links. New lookup backfills and foreign-value cascades prove physical relationship
copying rather than matching display caches; ordered multi-links, empty links, source/copy edits
and clearing a copy verify ordering and independence.
The v2 package's `community/packages/v2/e2e/src/duplicateField-link-matrix.e2e.spec.ts` retains
the same ten-case matrix through the v2 HTTP contract, independently of the Nest host adapter.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe DDL visitors.
- `PostgresTableSchemaFieldColumn.ts` - Role: helper; Purpose: resolve field column names + data types.
- `PostgresTableSchemaFieldCreateVisitor.ts` - Role: field visitor; Purpose: delegates to rules system to generate create statements.
- `PostgresTableSchemaFieldDeleteVisitor.ts` - Role: field visitor; Purpose: delegates to rules system to generate drop statements.
- `TableSchemaUpdateVisitor.ts` - Role: spec visitor; Purpose: delegate field DDL to create/delete visitors during schema updates.
- `LinkFieldValueDuplicateVisitor.ts` - Role: relationship-storage copy; Purpose: copy links without mutating the source relationship.

## Rules System

See `../rules/ARCHITECTURE.md` for details on the schema rules system.

Each field type maps to a set of rules via `FieldSchemaRulesFactory`. Rules include:

- `ColumnRule` - Standard column creation
- `GeneratedColumnRule` - GENERATED ALWAYS AS columns
- `IndexRule` / `UniqueIndexRule` - Indexes
- `ForeignKeyRule` - FK constraints
- `JunctionTableRule` - Junction tables for ManyMany/OneWay links
- `ReferenceRule` - Reference table entries

The `SchemaRuleResolver` handles dependency ordering and batch execution.
