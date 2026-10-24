Declaration: If the folder I belong to changes, please update me.

# v2/local-attachments Architecture Notes

## Responsibilities

- Store attachment bytes on the local filesystem using a content-addressed path.
- Write the `attachments` metadata row to the meta database.
- Read original bytes and optional thumbnails by token.
- Collect unreferenced metadata/files after a grace period.
- Stay outside `@teable/v2-core`; this is host infrastructure.

## Boundaries

- The record adapter owns `attachments_table` cell references and record writes.
- The headless runtime exposes an attachment store seam; this package is one
  Node/Bun implementation, not a core concept.
- A browser or S3 implementation can satisfy the same `put`/`read` shape.

## Files

- `src/index.ts` - `LocalAttachmentStore`, thumbnails, GC.
- `src/index.spec.ts` - put/read/dedup/thumbnail/GC tests on PGlite.

## GC

`collectGarbage` selects rows that are either soft-deleted or older than the
grace period and have no `attachments_table` reference. It re-checks the
reference inside the delete, removes the metadata row first, then removes the
original and thumbnail files. Archived records keep their references and are not
collected.

## Limits

- Thumbnails require a host-provided `thumbnailer`; no image codec is bundled.
- No background scheduler; the host decides GC cadence.
- Not browser-compatible because it uses `node:fs` and `node:crypto`.
