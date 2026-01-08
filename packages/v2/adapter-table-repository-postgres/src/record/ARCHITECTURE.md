Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-record-repository-postgres/src Architecture Notes

## Responsibilities

- Implement record-level persistence for Postgres (insert/update/delete).
- Provide query builders for stored/computed read paths.
- Host computed-field cascade update plumbing (planner + updater).
- Expose adapter-level DI wiring and entry points.

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
