Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# adapter-postgres-ddl visitors Architecture Notes

## Responsibilities

- Translate domain fields/specs into Postgres DDL operations.
- Support table create (column list) and schema updates (add columns).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe DDL visitors.
- `PostgresTableFieldColumn.ts` - Role: helper; Purpose: resolve field column names + data types.
- `PostgresTableSchemaFieldCreateVisitor.ts` - Role: field visitor; Purpose: create columns + field-specific side statements (formula references) for create/update.
- `TableSchemaUpdateVisitor.ts` - Role: spec visitor; Purpose: delegate field DDL to the field create visitor during schema updates.
