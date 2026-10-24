import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pglite';
import { createV2BrowserContainer } from '@teable/v2-container-browser';
import { sql, type Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';

import { LocalAttachmentStore } from './index';

describe('LocalAttachmentStore', () => {
  it('stores bytes and metadata, deduplicates identical content, and reads them back', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'teable-attachments-'));
    const container = await createV2BrowserContainer({ connectionString: 'memory://' });
    const db = container.resolve<Kysely<unknown>>(v2MetaDbTokens.db);

    try {
      const store = new LocalAttachmentStore({
        db,
        rootDir,
        actorId: 'usr_attachment_test',
        thumbnailer: ({ data }) => ({
          sm: new TextEncoder().encode('small'),
          lg: data,
        }),
      });
      const data = new TextEncoder().encode('hello attachment');

      const first = await store.put({
        name: 'hello.txt',
        mimetype: 'text/plain',
        data,
      });
      expect(first.token).toMatch(/^tok_[0-9a-f]{64}$/);
      expect(first.name).toBe('hello.txt');
      expect(first.size).toBe(data.byteLength);
      expect(new TextDecoder().decode(await store.read(first.token))).toBe('hello attachment');
      expect(new TextDecoder().decode(await store.readThumbnail(first.token, 'sm'))).toBe('small');

      const duplicate = await store.put({
        name: 'renamed.txt',
        mimetype: 'text/plain',
        data,
      });
      expect(duplicate.id).toBe(first.id);
      expect(duplicate.token).toBe(first.token);
      expect(duplicate.name).toBe('renamed.txt');
    } finally {
      await db.destroy();
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('collects unreferenced attachments without touching referenced rows', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'teable-attachments-gc-'));
    const container = await createV2BrowserContainer({ connectionString: 'memory://' });
    const db = container.resolve<Kysely<unknown>>(v2MetaDbTokens.db);

    try {
      const store = new LocalAttachmentStore({
        db,
        rootDir,
        actorId: 'usr_attachment_test',
        thumbnailer: ({ data }) => ({
          sm: new TextEncoder().encode('small'),
          lg: data,
        }),
      });
      const orphan = await store.put({
        name: 'orphan.txt',
        mimetype: 'text/plain',
        data: new TextEncoder().encode('orphan'),
      });
      const referenced = await store.put({
        name: 'referenced.txt',
        mimetype: 'text/plain',
        data: new TextEncoder().encode('referenced'),
      });

      await sql`
        insert into attachments_table
          (id, attachment_id, token, name, table_id, record_id, field_id, created_by)
        values
          ('atr_referenced_test', ${referenced.id}, ${referenced.token}, 'referenced.txt',
           'tbl_test', 'rec_test', 'fld_test', 'usr_attachment_test')
      `.execute(db);

      const { promise: settled, resolve: markSettled } = Promise.withResolvers<void>();
      setTimeout(markSettled, 10);
      await settled;

      const dryRun = await store.collectGarbage({ olderThanMs: 0, dryRun: true });
      expect(dryRun.deleted).toBe(1);

      const collected = await store.collectGarbage({ olderThanMs: 0 });
      expect(collected.deleted).toBe(1);
      expect(collected.filesDeleted).toBe(3);

      await expect(store.read(orphan.token)).rejects.toThrow('Attachment not found');
      await expect(store.readThumbnail(orphan.token)).rejects.toThrow('Attachment not found');
      expect(new TextDecoder().decode(await store.read(referenced.token))).toBe('referenced');
    } finally {
      await db.destroy();
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);
});
