Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# application/services Architecture Notes

## Responsibilities

- Implement application services that coordinate repositories, schema updates, and event publishing.
- Provide transactional orchestration around domain mutations and specs.
- Keep domain logic inside domain model/visitors; this layer only wires ports and supplies
  preloaded data for cross-table validation.

## Operation preview preparation

Canonical operation previews are coordinated by `@teable/v2-command-explain`, not by adding
`dryRun` flags to write commands. This layer supplies shared preparation seams where execution
and preview can reuse input interpretation and domain decisions before persistence. Preparation
must stay separate from transactions that persist metadata/data, publish events, capture undo,
enqueue outbox work, or invoke external hooks. Reusing a preparation seam is not evidence that
every downstream execution policy or hook has been checked by preview.

Preview effects describe the evidence available for an exact pending write input. Missing row
selection, authorization, dependency, or host-policy evidence remains unknown; an empty effect
list does not establish that a write has no impact. The caller must retain blockers and unknown
coverage instead of replacing them with zero counts or a successful empty result.

Core remains the Table bounded context. Space/base-node placement, billing and quotas, trash
retention, attachments, workflows, shares, and other host configuration belong to host preview
adapters; do not add those concepts to core commands or ports to complete a preview.

The preview is advisory: it does not reserve capacity, lock the selected records, or issue an
approval token. Execution still parses and authorizes the original input and runs its normal
preparation and policy checks against current state.

## Files

- `FieldConversionPreparationService.ts` - Role: shared update/conversion preparation; Purpose:
  validate references and build update specs on detached aggregates for `UpdateFieldHandler` and
  preview. Execution-only field plugins and downstream cascades are not established here.
- `FieldDeletionPreparationService.ts` - Role: shared single/batch field-deletion preparation;
  Purpose: project direct removal, symmetric-link effects, surviving dependents and view cleanup.
  Missing foreign metadata stays explicit; internal aggregates/specs are not public preview DTOs.
- `TableDeletionPreparationService.ts` - Role: shared table-delete preparation; Purpose: resolve
  active targets, or trashed targets for permanent deletion, and prepare direct side-effect reactions.
  `TableDeletionSideEffectService.prepare` is separate from `executePrepared`; inconclusive or
  empty incoming-reference candidates do not prove an absence of impact or downstream cascades.
- `DuplicateTablePreparationService.ts` - Role: shared detached aggregate duplication; Purpose:
  project fields/views, validate formula admission and classify links. It does not read/copy
  records or finalize physical-copy applicability before target metadata is persisted.
- `PastePreparationService.ts` - Role: shared selection, create/update split and schema projection;
  Purpose: interpret view/filter/search/range and editable-column scope. Prepared counts precede
  execution write policy; link-title candidates are not counts of auto-created foreign rows.
  `applyWriteScope` is the separate step that consumes execution policy decisions.
- `BulkRecordPreparationService.ts` - Role: data-only explicit/selector preparation; Purpose:
  expose loaded/selected/missing records and optional read-only policy evidence. Execution also
  reuses its exported scope/resolution helpers. An absent policy is not unrestricted access;
  nonempty affected-update counts generally remain unknown until mutation resolution.
- `DeleteByRangeApplicationService.ts` - Role: range-delete orchestration; Purpose: share only
  its read-only `prepareDelete` method with preview while retaining execution/stream methods in
  the application service. Preview does not cover streaming deletion's chunk policy.

- `DomainWriteTransaction.ts` - Role: event-aware transaction orchestration; Purpose: apply same-tx
  projections and append the journal before commit. Streaming imports snapshot complete event
  batches externally, finalize exact operation totals when input ends, then replay bounded batches
  for same-tx projections and journal writes before committing. Post-commit consumers are drained
  with backpressure using those same totals.
  `finalizeAfterCommit` runs before delivery; a failure cannot be reported as a rolled-back write.
- `ImportRecordBatchTotals.ts` - Role: bounded import metadata; Purpose: count rows and chunks by
  table/operation without retaining payloads, preserving bulk realtime and notification policy.
- `FieldCreationSideEffectService.ts` - Role: application service; Purpose: validate cross-table field
  dependencies (via visitors) and apply side effects after field creation.
- `FieldDeletionSideEffectService.ts` - Role: application service; Purpose: apply cross-table side
  effects after field deletion (e.g. remove symmetric link fields).
- `ForeignTableLoaderService.ts` - Role: application service; Purpose: load foreign tables once and
  validate missing references.
- `TableDeletionSideEffectService.ts` - Role: application service; Purpose: dispatch explicit
  `OnTeableTableDeleted` reactions in other tables before deleting a table, including link-to-text
  conversion and dependent metadata cleanup.
- `RecordBulkUpdateService.ts` - Role: application service; Purpose: prepare and execute selector
  or explicit-record batch updates, letting the domain model build specs/results while the service
  coordinates repository persistence, events, and undo/redo.
- `PasteLinkAutoResolveService.ts` - Role: paste-specific link-title validation and resolution.
  Both range paste and ID-based paste must validate textual link targets before record writes;
  ID-based hosts also validate planned link columns before persisting column expansion. Clipboard
  repetition uses the final planned width, and permission-filtered updates and creates share this
  preflight. Generic typecast updates are not a substitute because unresolved titles can become
  empty links.
  Titles resolve against the link's display field (`lookupFieldId`), not only the foreign primary;
  text, numeric, and single-select display fields match their stored value, while a checkbox display
  resolves through the foreign primary like the read model. Missing values must
  still be refused when creation cannot fill the shown column (non-primary display, computed
  primary, required fields without defaults) so the user sees the reason instead of a silently
  empty cell; `paste.link_auto_create_computed_primary_unsupported` covers computed primaries
  (including auto-number) and text formulas may still resolve existing titles. Explicit record IDs
  and empty link values do not request title resolution.
- `RecordReorderService.ts` - Role: application service; Purpose: apply batched row-order updates
  and build reorder events plus undo/redo payloads for callers that need native v2 reorder flows.
- `ImportTabularTableService.ts` - Role: application service; Purpose: shared create-table
  import workflow for parsed CSV/Excel named rows. It emits complete batch-created events instead
  of retaining per-record events on `Table`, closes source iterators on every exit, and commits
  the table's ready state after data commit but before realtime/automation consumers run.
  Unknown source totals stay unknown at preflight; the prepared table-operation policy checks
  cumulative rows before every inserted batch, so the whole-table creation limit cannot be bypassed.
- `TableQueryService.ts` - Role: application service; Purpose: common table lookup operations
  (getById, getByIdInBase, exists) used across CommandHandlers and QueryHandlers.
- `TableUpdateFlow.ts` - Role: application service; Purpose: shared table update workflow (mutate +
  persist + publish), including mapping one persisted View query-default version touch to its
  filter/group/sort semantic events without consuming later mutation versions. Physical schema
  completion publishes `TableProvisionReady` after ready is committed, even when mutation events
  are deferred with `publishEvents: false`; outer transactions own this notification after commit.
- `FieldUndoRedoReplayService.ts` - Role: field snapshot replay; Purpose: restore field state through aggregate mutation when changing `hasError`, so persisted recovery also emits `FieldUpdated` to existing realtime subscribers.
- `ViewPluginCreationService.ts` - Role: application service; Purpose: resolve external Plugin
  definitions and prepare/install Plugin View integrations around aggregate creation.
- `ViewManualSortService.ts` - Role: application service; Purpose: execute aggregate-declared
  row-order schema preparation and stream stable row-order updates through record repositories.
