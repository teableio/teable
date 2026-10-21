Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# domain/table/methods Architecture Notes

## Responsibilities

- Extracted Table aggregate method implementations to reduce `Table.ts` size.
- Each method is a standalone function using `this: Table` and is delegated from `Table`.

## Subfolders

- `records/` - Record creation/update/streaming methods and shared record builders.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe method extraction approach.
- `createView.ts` - Role: Table aggregate method; Purpose: create and initialize a View, enforce
  Table-scoped defaults/invariants, and return the resulting mutation specification.
- `createViewLinkRecordsQueryPlan.ts` - Role: Table aggregate query planner; Purpose: validate an
  owned View and Link Field, enforce share visibility, and choose candidate/selected Record scope.
- `createViewCollaboratorsQueryPlan.ts` - Role: Table aggregate query planner; Purpose: keep View
  subtype, visible user-related Field, and all-versus-referenced collaborator policy inside Table.
- `createViewSelectionCopyPlan.ts` - Role: Table aggregate query planner; Purpose: bind clipboard
  ranges and projections to an owned shared View, enforce share metadata, and expose bounded
  Table Record read windows.
- `createCollapsedGroupExclusionFilter.ts` - Role: Table aggregate query planner; Purpose: turn
  collapsed group paths into canonical Record filters using aggregate-owned Field semantics.
- `deleteView.ts` - Role: Table aggregate methods; Purpose: enforce owned/last-View invariants, derive
  cross-aggregate Link cleanup plans, and clear matching Link filter dependencies.
- `duplicate.ts` - Role: method function; Purpose: duplicate a table aggregate by remapping internal
  ids/references while preserving external-table semantics.
- `rename.ts` - Role: method function; Purpose: rename table and emit TableRenamed event.
- `updateViewSort.ts` - Role: Table aggregate method; Purpose: validate owned sort Fields, preserve
  unrelated View query defaults, and return a focused query-defaults mutation spec.
- `applyViewManualSort.ts` - Role: Table aggregate method; Purpose: validate Grid View ownership and
  sort Fields, enable manual mode, and return row-order materialization/storage intent.
- `validateFormSubmission.ts` - Role: method function; Purpose: validate form-submit constraints (view
  type, visible fields, required fields).
- `viewFilterLinkReferences.ts` - Role: Table aggregate query method; Purpose: resolve linked-record
  references from an owned View filter and the Table's Link Fields.
- `fieldFilterLinkScope.ts` - Role: Table aggregate query method; Purpose: extract the foreign
  Table and filter from an owned Link or ConditionalRollup Field.
- `records/ARCHITECTURE.md` - Role: subfolder architecture note; Purpose: describe record method functions.
