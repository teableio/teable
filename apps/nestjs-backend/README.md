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

## User-field notification recipients

A valid complete `{ id, email }` pair can retain a user reference across spaces,
but writing that reference does not authorize a collaborator notification. V1 and
V2 notification dispatchers intersect candidate user IDs with the destination
table's effective base/space collaborators (including enterprise departments)
before loading record titles or scheduling a notification. The existing source
rules still keep imports, table duplication, trash restore, and undo/redo silent.

Regression coverage: `test/v2-user-field-notify-bulk-actions.e2e-spec.ts` checks
V1/V2 strict create/update with an external user and a base- or space-level
collaborator, then repeats the write after revoking the collaborator's grant.
Complete identities persist canonically in all cases; only current collaborators
receive a notification or mail-send call.

## Shared SSE transport

`streamSseResponse` serializes source pulls and response writes. When `write()`
returns false, it waits for `drain` before pulling another event; idle heartbeats
use the same writer. Signal-aware source factories receive cancellation on socket
close or error and must use that signal to settle pending work.

Protocols opt into terminal event detection. Existing callers can still emit
nonterminal per-chunk errors; the shared writer does not interpret payloads by
default. The OpenAPI `streamSSE` client awaits result callbacks, supports opt-in
terminal IDs, and cancels/releases its reader when consumption ends or fails.

Regression coverage: `src/utils/sse-stream.spec.ts` uses real loopback TCP for
paused-consumer and disconnect behavior; OpenAPI's `src/utils/sse.spec.ts` covers
incremental client delivery and reader cleanup. These are transport proofs, not
database deletion, undo/redo, or whole-request memory acceptance.

## Table socket snapshot queries

`GET /api/base/:baseId/table/socket/snapshot-bulk` requires `ids` to be an
array of strings, encoded as `ids[]=<tableId>` (repeat the key for multiple tables).
Both Community and Enterprise validate this query before reading table permissions
or snapshots. Scalar, comma-separated, object-valued, and missing `ids` return 400;
they are not normalized or treated as an unfiltered table read. Authorized array
requests are unchanged, including Enterprise's 403 for a mixed allowed/denied list.

Regression coverage: `test/v2-unmigrated-routes.e2e-spec.ts` and the Enterprise
backend's `test/authority/table.e2e-spec.ts`.

## Base `.tea` export resource contract

Each Nest application admits one distinct Base export at a time, shared by its
Community and Enterprise exporters, including legacy Bases with `v2_enabled=false`.
Identical Base, `includeData`, and user requests share the result and latest progress;
different users never share download URLs.
A Redis lease also excludes other processes exporting that Base, even with a
different `includeData` value. Its confirmed 60-second lifetime starts with the lease
request; renewal is attempted every 20 seconds. A local deadline aborts work even
when Redis is still awaiting a response. Admission stays occupied until outstanding
lease operations and export cleanup settle.
Conflicts return 429 with `data.domainCode = base.export_busy` on the JSON endpoint;
unavailable leases return 503. SSE errors preserve the same status, code, and data
after response headers have been sent. The export dialog displays a specific busy
message without automatic retries. Redis failures never fall back to local execution.
Genuine Map-backed caches provide local admission only.

Table records and attachment references use demand-driven 500-row pages. CSV and
ZIP queues use 64 KiB byte buffers; CSV work yields after 64 KiB or an 8 ms work slice.
Each attachment body is opened lazily and consumed before opening the next entry.
One cell's JSON conversion and one CSV row remain atomic. Schema metadata, unique
attachment identities, and the ZIP entry index still grow with the Base's structure;
these limits are not a fixed RSS limit or an isolated worker CPU quota.

Disconnecting one caller leaves other subscribers running. Disconnecting the last
caller, losing the lease, or failing any export stage aborts the producer, ZIP, and
upload. Admission remains occupied until processing and upload cleanup settle.
Only the last caller leaving produces one cancellation notification after cleanup,
including cancellation while lease acquisition is pending. A surviving subscriber
still receives the one normal result notification. The dialog warns about refreshing
or leaving the page. SPA navigation and unmount abort that caller's request;
dismissing the dialog alone does not cancel.
Once export work has succeeded or failed, a caller leaving during lease cleanup does
not replace that terminal result with cancellation.
An already-issued database query or download-header request may finish before its
abort check; no subsequent metadata read, page, or file is started. Storage receives
the job signal through the final response, even after the ZIP source reaches EOF.
S3 and Minio wait for active transport requests and multipart cleanup. Local storage
hashes and writes once into a staging directory beside the destination, then publishes
with atomic rename. Cancellation before publication preserves an existing object;
cleanup removes only the owned staging directory. Once rename is issued, successful
publication is not rolled back by later cancellation.

The hourly cleanup reclaims recognized local `.upload-<six alphanumeric>` crash
remnants after 24 hours without a staging heartbeat, normally within 25 hours after
a crash. Live uploads refresh their opened directory inode every minute and are
protected across storage instances in the same process. A backend paused for more
than 24 hours can lose its staging lease; missing or replaced staging prevents
publication and preserves the destination. Published exports retain their signed-link TTL.

Regression coverage: `test/base-export-failure.e2e-spec.ts` exercises real HTTP/SSE
admission, slow uploads, responsive reads and health checks, failures, and disconnects.
The V2 parity case in `test/import-base.e2e-spec.ts` roundtrips quoted/multiline text
and attachment bytes. Stream, coordinator, S3, and Enterprise archive unit tests cover
bounded reads, lease failures, iterator cleanup, and nested archive cancellation.
The local storage upload tests also exercise cancellation after a storage file opens,
preservation of existing bytes, removal of partial files, and subsequent replacement.

Frontend consumer regressions in `BaseActionTrigger.spec.tsx` cover busy SSE/JSON
responses, SPA departure, unmount, and dialog dismissal. `NotificationsManage.spec.tsx`
checks that the serialized cancellation message is displayed rather than reported as
a successful export.

## Tabular import validation

V2 CSV/Excel new-table and append imports replace unparseable optional dates with
empty cells. Dates must stay within UTC years 0001–9999 after timezone conversion.
Google Sheets applies the same range after its source-specific serial conversion;
Excel retains its cell-format and workbook date-system conversion. Plain numeric
CSV strings are not interpreted as Excel serials.

An import may skip an unrepresentable row only for an explicit row-local field
construction error, such as a missing required value after conversion. Filtering
precedes append write plugins, select-option side effects and record persistence.
Permissions, source failures, admission limits, resolution and database errors stay
fatal; ordinary record writes retain atomic validation. Rejected source rows still
count against the existing input limit and do not grant extra capacity.

Successful SSE results expose exact invalid-date and skipped-row counts, plus at
most 100 row/field examples per table/import without source-cell values. Progress
and imported counts include committed records only. CSV source rows are 1-based
record ordinals including blank records; quoted multiline records count once.
Excel uses original worksheet rows. The synchronous append endpoint retains its
existing empty response; clients needing diagnostics use its streaming counterpart.

Regression coverage: `test/table-import.e2e-spec.ts`, the v2 import HTTP suites,
Google Sheets schema/service unit tests, and the CSV/Excel adapter tests.
