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

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe DDL visitors.
- `PostgresTableSchemaFieldColumn.ts` - Role: helper; Purpose: resolve field column names + data types.
- `PostgresTableSchemaFieldCreateVisitor.ts` - Role: field visitor; Purpose: delegates to rules system to generate create statements.
- `PostgresTableSchemaFieldDeleteVisitor.ts` - Role: field visitor; Purpose: delegates to rules system to generate drop statements.
- `TableSchemaUpdateVisitor.ts` - Role: spec visitor; Purpose: delegate field DDL to create/delete visitors during schema updates.

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
