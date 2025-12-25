Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# adapter-postgres-ddl visitors Architecture Notes

## Responsibilities

- Translate domain fields/specs into Postgres DDL operations.
- Support table create (column list) and schema updates (add columns).

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe DDL visitors.
- `PostgresTableFieldVisitor.ts` - Role: field visitor; Purpose: add columns during table creation.
- `PostgresTableFieldSchemaUpdateVisitor.ts` - Role: field visitor; Purpose: build add-column + reference statements during schema updates.
- `TableSchemaUpdateVisitor.ts` - Role: spec visitor; Purpose: collect fields to add during schema updates.
