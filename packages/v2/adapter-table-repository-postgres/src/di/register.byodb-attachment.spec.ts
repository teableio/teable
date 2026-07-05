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
 * connection from the meta database (platform Prisma DB, `config.metaDb`). The
 * attachment metadata tables (`attachments` / `attachments_table`) only exist in
 * the meta DB. The attachment lookup must therefore run against `metaDb`; if it
 * runs against the data db it finds nothing and every insertAttachment fails.
 *
 * In non-BYODB spaces `metaDb === db`, which is why the bug is invisible outside
 * BYODB. These tests wire distinct data/meta dbs to reproduce the BYODB split.
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

const registerWithSplitDbs = (
  dataDb: DbSpy,
  metaDb: DbSpy
): DependencyContainer => {
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

  it('resolves attachmentId lookups against the meta db, not the data db', async () => {
    const dataDb = createDbSpy();
    const metaDb = createDbSpy();
    const c = registerWithSplitDbs(dataDb, metaDb);

    const service = c.resolve<IAttachmentLookupService>(v2CoreTokens.attachmentLookupService);
    const result = await service.listAttachmentsByAttachmentIds(['act_byodb']);

    expect(result.isOk()).toBe(true);
    expect(metaDb.selectFrom).toHaveBeenCalledWith('attachments_table as attachmentsTable');
    expect(dataDb.selectFrom).not.toHaveBeenCalled();
  });
});
