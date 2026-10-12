# NestJS backend for teable

TODO:
remove @valibot/to-json-schema in ai-sdk6
remove effect in ai-sdk6
remove @ai-sdk/provider-utils in ai-sdk6

## ShareDB record recovery

V2 socket snapshots retain empty cells as explicit `null` values within their
authorized projection; ordinary record REST responses still omit empty cells.
Version-gap recovery turns those snapshot entries into per-field set operations.
Omitting empty cells here can advance the client version without clearing stale
links or lookups after missed or out-of-order realtime updates. Keep clears
explicit rather than deleting keys: hydrated record-detail views merge HTTP
values underneath the live document and need `null` to override older values.

Regression coverage: `test/record-socket-gap-recovery.e2e-spec.ts` exercises a
retained document after unlinking, and bulk recovery of an entirely empty record.
