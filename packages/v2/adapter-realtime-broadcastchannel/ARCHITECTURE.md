Declaration: If the folder I belong to changes, please update me, especially core domain concepts. Add examples or example file paths for abstract concepts when needed.

# v2/adapter-realtime-broadcastchannel Architecture Notes

## Responsibilities

- Provide a BroadcastChannel-backed IRealtimeEngine implementation for sandbox-style realtime.
- Maintain an in-memory snapshot store keyed by RealtimeDocId.
- Broadcast snapshot updates across browser tabs.

## Files

- `ARCHITECTURE.md` - Role: folder architecture note; Purpose: describe the adapter package scope.
- `src/BroadcastChannelRealtimeHub.ts` - Role: adapter helper; Purpose: manage channel + in-memory snapshots.
- `src/BroadcastChannelRealtimeEngine.ts` - Role: realtime adapter; Purpose: map IRealtimeEngine to hub updates.
- `src/di/register.ts` - Role: DI helper; Purpose: register engine for BroadcastChannel realtime.
- `src/di/tokens.ts` - Role: DI tokens; Purpose: adapter token IDs.
- `src/index.ts` - Role: package entry; Purpose: export public adapter surface.
