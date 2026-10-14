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

## Attachment write validation

V2 attachment uploads and inserts reject computed fields before checking their
attachment type. This preserves the read-only rejection for system fields such as
created time without uploading a file or changing the cell. Writable non-attachment
fields retain their type error; valid attachment writes still append to existing files.
Regression coverage: `test/attachment.e2e-spec.ts` exercises multipart uploads,
attachment inserts, unchanged stored values, and successful attachment appends.
