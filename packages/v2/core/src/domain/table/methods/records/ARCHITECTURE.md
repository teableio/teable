Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/methods/records Architecture Notes

## Responsibilities

- Record-related Table method implementations (create/update/stream).
- Shared helpers for building records and mutation specs.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe record method functions.
- `createRecord.ts` - Role: method function; Purpose: create a single record with defaults.
- `updateRecord.ts` - Role: method function; Purpose: update record with mutation spec.
- `createRecords.ts` - Role: method function; Purpose: batch record creation.
- `createRecordsStream.ts` - Role: method function; Purpose: streaming record creation for sync iterables.
- `createRecordsStreamAsync.ts` - Role: method function; Purpose: streaming record creation for async iterables.
- `recordBuilders.ts` - Role: shared helpers; Purpose: build records/mutation specs for record methods.
- `index.ts` - Role: barrel export; Purpose: re-export record method functions for `Table`.
