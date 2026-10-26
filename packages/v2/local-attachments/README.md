# @teable/v2-local-attachments

Local filesystem attachment storage for the Teable headless runtime.

```ts
import { v2MetaDbTokens } from "@teable/v2-adapter-db-postgres-shared";
import { LocalAttachmentStore } from "@teable/v2-local-attachments";

const store = new LocalAttachmentStore({
  db: runtime.container.resolve(v2MetaDbTokens.db),
  rootDir: "./data/attachments",
  actorId: "usr_local",
  // Optional; the host supplies image resizing.
  thumbnailer: async ({ data }) => ({
    sm: await makeSmall(data),
    lg: await makeLarge(data),
  }),
});

const item = await store.put({
  name: "receipt.pdf",
  mimetype: "application/pdf",
  data: bytes,
});

const bytes = await store.read(item.token);
const small = await store.readThumbnail(item.token, "sm");

await store.collectGarbage({ olderThanMs: 24 * 60 * 60 * 1000 });
```

The store writes content-addressed files and the `attachments` metadata row. The
record adapter writes the `attachments_table` cell references when an attachment
field is persisted.

## Current limits

- Node/Bun only; browser runtimes need an OPFS/IndexedDB or host-provided store.
- No S3 adapter in this package; inject another store at the runtime seam.
- Thumbnails require a host-provided `thumbnailer`; no image codec is bundled.
- GC is an explicit call. It removes unreferenced metadata + original/thumbnail
  files after the grace period and skips rows still referenced by
  `attachments_table`.
