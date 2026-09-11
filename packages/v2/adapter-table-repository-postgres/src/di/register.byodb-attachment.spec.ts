import { v2CoreTokens, type IAttachmentLookupService } from '@teable/v2-core';
import { container, type DependencyContainer } from '@teable/v2-di';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { registerV2TableRepositoryPostgresAdapter } from './register';

/**
 * Regression test for T5395: uploading an attachment fails in BYODB spaces with
 * "Attachment(<token>) not found" (HTTP 400).
 *
 * In a BYODB space the data database (customer-owned, `config.db`) is a different
 * connection from the meta database (platform Prisma DB, `config.metaDb`). File
 * metadata (`attachments`) lives in the meta DB because the upload API writes
 * there. Cell reference rows (`attachments_table`) are written with the record
 * SQL on dataDb. Token lookup must therefore use metaDb; attachmentId lookup
 * must read refs from dataDb and join metadata from metaDb.
 *
 * In non-BYODB spaces `metaDb === db`, which is why the split is invisible
 * outside BYODB. These tests wire distinct data/meta dbs to reproduce it.
 */

type DbSpy = {
  selectFrom: ReturnType<typeof vi.fn>;
  insertInto: ReturnType<typeof vi.fn>;
  updateTable: ReturnType<typeof vi.fn>;
  deleteFrom: ReturnType<typeof vi.fn>;
};

const createDbSpy = (): DbSpy => {
  const execute = vi.fn(async () => [] as unknown[]);
  const where = vi.fn(() => ({ execute }));
  const select = vi.fn(() => ({ where }));
  const innerJoin = vi.fn(() => ({ select }));
  return {
    selectFrom: vi.fn(() => ({ select, innerJoin })),
    insertInto: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  };
};

const createSelectDb = (rowsByTable: Record<string, unknown[]>): DbSpy => ({
  selectFrom: vi.fn((table: string) => ({
    select: () => ({
      where: () => ({
        execute: async () => rowsByTable[table] ?? [],
      }),
    }),
  })),
  insertInto: vi.fn(),
  updateTable: vi.fn(),
  deleteFrom: vi.fn(),
});

const registerWithSplitDbs = (dataDb: DbSpy, metaDb: DbSpy): DependencyContainer => {
  const c = container.createChildContainer();
  registerV2TableRepositoryPostgresAdapter(c, {
    db: dataDb as unknown as Kysely<never>,
    metaDb: metaDb as unknown as Kysely<never>,
  } as never);
  return c;
};

describe('BYODB attachment lookup wiring (T5395)', () => {
  it('resolves attachment token lookups against the meta db, not the data db', async () => {
    const dataDb = createDbSpy();
    const metaDb = createDbSpy();
    const c = registerWithSplitDbs(dataDb, metaDb);

    const service = c.resolve<IAttachmentLookupService>(v2CoreTokens.attachmentLookupService);
    const result = await service.listAttachmentsByTokens(['tok_byodb']);

    expect(result.isOk()).toBe(true);
    expect(metaDb.selectFrom).toHaveBeenCalledWith('attachments');
    expect(dataDb.selectFrom).not.toHaveBeenCalled();
  });

  it('resolves attachmentId lookups from data-db refs and meta-db file metadata', async () => {
    const dataDb = createSelectDb({
      attachments_table: [
        {
          id: 'attt_1',
          attachment_id: 'act_byodb',
          token: 'tok_byodb',
          name: 'file.txt',
          table_id: 'tbl_1',
          record_id: 'rec_1',
          field_id: 'fld_1',
        },
      ],
    });
    const metaDb = createSelectDb({
      attachments_table: [],
      attachments: [
        {
          id: 9,
          token: 'tok_byodb',
          path: '/tmp/file.txt',
          size: '12',
          mimetype: 'text/plain',
          thumbnailPath: null,
        },
      ],
    });
    const c = registerWithSplitDbs(dataDb, metaDb);

    const service = c.resolve<IAttachmentLookupService>(v2CoreTokens.attachmentLookupService);
    const result = await service.listAttachmentsByAttachmentIds(['act_byodb']);

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'act_byodb',
        attachmentId: 'act_byodb',
        name: 'file.txt',
        token: 'tok_byodb',
        path: '/tmp/file.txt',
        size: 12,
        mimetype: 'text/plain',
        width: undefined,
        height: undefined,
        thumbnailPath: undefined,
      },
    ]);
    expect(dataDb.selectFrom).toHaveBeenCalledWith('attachments_table');
    expect(dataDb.selectFrom).not.toHaveBeenCalledWith('attachments');
    expect(metaDb.selectFrom).toHaveBeenCalledWith('attachments_table');
    expect(metaDb.selectFrom).toHaveBeenCalledWith('attachments');
  });
});
