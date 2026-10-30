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

## Cross-project reciprocal Link fields

V2 field-operation plugins authorize reciprocal Link schema mutations on the actual
target table, using `field|create`, `field|update`, or `field|delete` for that mutation.
Permission to read the target records is not permission to change its schema.
The source route's permissions, scoped robot identity, or temporary base grant do
not grant schema writes to a different project; personal-token scopes still apply.
Denied operations leave both source and target schemas unchanged.

One-way cross-project references remain available to readers. Ordinary inverse
record synchronization through an established two-way relationship is unchanged.
Regression coverage: `test/cross-base-link-field-authz.e2e-spec.ts`.

## Nested Link-title record creation

Pasting an unresolved Link title requires `record|create` on the actual target
table before any nested row write. If typecasting a surviving target primary value
would add a select option, the actor also needs `field|update` on that same target;
resolving an existing option does not require a schema grant. The schema check runs
in `afterGuard`, after all row-overflow and cell-isolation guards finish but before
select-option side effects or persistence. Discarded rows do not demand schema
permission, while surviving new options still fail closed without it. Core carries
the originating base, table, and Link field as `linkTitleSource`, but no host permissions.
Direct batch creates, upsert, table seeds, and duplication do not gain this
additional gate merely because they also use `createMany`.

Community uses target role permissions. Enterprise installs its existing record
write and target-schema policies in the same container, so matrix grants and field
restrictions are not replaced by a second Community role check. Only robot actors
use temporary-base scope; a human JWT remains governed by the host policy. PAT
resource/action limits and native share-view, project-share, and template scopes
still apply to the target. Unscoped internal/system calls retain their existing
behavior.
Regression coverage: `test/cross-base-paste-auto-create-authz.e2e-spec.ts` and the
record feature's Link-title permission and plugin-registrar unit tests.
