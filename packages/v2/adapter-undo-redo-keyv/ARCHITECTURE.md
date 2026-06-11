Declaration: If the folder I belong to changes, please update me, especially public exports or storage behavior.

# adapter-undo-redo-keyv Architecture Notes

## Responsibilities

- Provide a Keyv-backed implementation of `@teable/v2-core` `IUndoRedoStore`.
- Persist undo/redo entries with cursor semantics compatible with `UndoRedoStackService`.
- Keep storage concerns out of `v2/core`.

## Files

- `src/KeyvUndoRedoStore.ts` - Role: store adapter; Purpose: persist undo/redo entries in Keyv.
- `src/KeyvUndoRedoStore.spec.ts` - Role: unit tests; Purpose: verify cursor, redo truncation, and retention semantics.
- `src/index.ts` - Role: package entry; Purpose: export the adapter surface.
