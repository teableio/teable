Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/methods Architecture Notes

## Responsibilities

- Extracted Table aggregate method implementations to reduce `Table.ts` size.
- Each method is a standalone function using `this: Table` and is delegated from `Table`.

## Subfolders

- `records/` - Record creation/update/streaming methods and shared record builders.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe method extraction approach.
- `rename.ts` - Role: method function; Purpose: rename table and emit TableRenamed event.
- `validateFormSubmission.ts` - Role: method function; Purpose: validate form-submit constraints (view
  type, visible fields, required fields).
- `records/ARCHITECTURE.md` - Role: subfolder architecture note; Purpose: describe record method functions.
