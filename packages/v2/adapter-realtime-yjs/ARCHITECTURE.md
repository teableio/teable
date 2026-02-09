Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-realtime-yjs Architecture Notes

## Responsibilities

- Provide a Yjs-backed IRealtimeEngine implementation for v2 core.
- Translate RealtimeChange operations into Yjs updates.
- Keep transport and WebSocket concerns out of this package.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe the adapter package scope.
- `src/YjsRealtimeEngine.ts` - Role: realtime adapter; Purpose: map IRealtimeEngine to Yjs behavior.
- `src/index.ts` - Role: package entry; Purpose: export the Yjs adapter.
