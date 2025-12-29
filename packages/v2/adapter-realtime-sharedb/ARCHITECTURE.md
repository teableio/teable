Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-realtime-sharedb Architecture Notes

## Responsibilities

- Provide a ShareDB-backed IRealtimeEngine implementation for v2 core.
- Publish ShareDB ops (create/edit/delete) through a pluggable publisher.
- Offer a small WebSocket transport helper for ShareDB servers.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe the adapter package scope.
- `src/ShareDbPublisher.ts` - Role: adapter port; Purpose: define op publisher contract and types.
- `src/ShareDbBackendPublisher.ts` - Role: adapter helper; Purpose: submit ops through ShareDB backend.
- `src/ShareDbRealtimeEngine.ts` - Role: realtime adapter; Purpose: map IRealtimeEngine to ShareDB ops.
- `src/ShareDbWebSocketServer.ts` - Role: transport helper; Purpose: bind ShareDB to a WebSocket server.
- `src/websocket-json-stream.d.ts` - Role: type shim; Purpose: declare module types for WebSocket JSON streams.
- `src/di/register.ts` - Role: DI helper; Purpose: register engine + projections.
- `src/di/tokens.ts` - Role: DI tokens; Purpose: ShareDB adapter token IDs.
- `src/index.ts` - Role: package entry; Purpose: export public adapter surface.
