Declaration: If the folder I belong to changes, please update me, especially public exports or storage behavior.

# adapter-undo-redo-keyv Architecture Notes

## Responsibilities

- Provide a Keyv-backed implementation of `@teable/v2-core` `IUndoRedoStore`.
- Persist undo/redo entries with cursor semantics compatible with `UndoRedoStackService`.
- Keep storage concerns out of `v2/core`.

## Grouped replay

Reservations contain entry counts and progress, not a materialized interaction.
`readReservedEntry` loads one payload in replay order and rejects stale tokens,
invalid indices, and missing entries. Retention keeps complete logical groups;
reference-capacity rejection precedes metadata or payload mutation.

Split-v1 and legacy readable values keep their original expiry. The existing
plain/gzip/Brotli codecs remain unchanged. Progress and lease renewal share one
reservation update; a stale token changes neither. Eager store inspection helpers
remain explicit and are not the application replay path.

## Files

- `src/KeyvUndoRedoStore.ts` - Role: store adapter; Purpose: persist undo/redo entries in Keyv.
- `src/KeyvUndoRedoStore.spec.ts` - Role: unit tests; Purpose: verify cursor, redo truncation, and retention semantics.
- `src/index.ts` - Role: package entry; Purpose: export the adapter surface.
