import type { Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPGliteDb,
  type PGliteTestDb,
} from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import type { DynamicDB } from '../query-builder';

import {
  deleteAttachmentTableRefsByRecordIds,
  deleteAttachmentTableRefsByFieldIds,
  iterateAttachmentTableRefs,
  listAttachmentTableRefs,
  listAttachmentTokensByTableIds,
} from './attachmentTableQueries';

type AttachmentTableRawRow = {
  id: string;
  attachment_id: string;
  token: string | null;
  name: string;
  table_id: string;
  record_id: string;
  field_id: string;
};

type AttachmentTableDbSpy = {
  selectFrom: ReturnType<typeof vi.fn>;
  deleteFrom: ReturnType<typeof vi.fn>;
};

const createSelectDb = (
  rows: Array<{
    id: string;
    attachment_id: string;
    token: string;
    name: string;
    table_id: string;
    record_id: string;
    field_id: string;
  }>
): AttachmentTableDbSpy => {
  const execute = vi.fn(async () => rows);
  const where = vi.fn(() => ({ where, execute }));
  const select = vi.fn(() => ({ where }));
  return {
    selectFrom: vi.fn(() => ({ select })),
    deleteFrom: vi.fn(),
  };
};

const createDeleteDb = (): AttachmentTableDbSpy & { execute: ReturnType<typeof vi.fn> } => {
  const execute = vi.fn(async () => undefined);
  const where = vi.fn(() => ({ where, execute }));
  return {
    selectFrom: vi.fn(),
    deleteFrom: vi.fn(() => ({ where })),
    execute,
  };
};
const attachmentRefFixture = (
  id: string,
  overrides: Partial<AttachmentTableRawRow> = {}
): AttachmentTableRawRow => ({
  id,
  attachment_id: `act_${id}`,
  token: `tok_${id}`,
  name: `${id}.txt`,
  table_id: 'tbl_1',
  record_id: `rec_${id}`,
  field_id: 'fld_1',
  ...overrides,
});

const insertAttachmentFixtures = async (
  fixture: PGliteTestDb,
  rows: AttachmentTableRawRow[]
): Promise<void> => {
  for (const row of rows) {
    await fixture.pglite.query(
      `INSERT INTO attachments_table
        (id, attachment_id, token, name, table_id, record_id, field_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, row.attachment_id, row.token, row.name, row.table_id, row.record_id, row.field_id]
    );
  }
};

describe('attachmentTableQueries pagination', () => {
  let data: PGliteTestDb;
  let meta: PGliteTestDb;
  let dataDb: Kysely<DynamicDB>;
  let metaDb: Kysely<DynamicDB>;

  beforeAll(async () => {
    data = await createPGliteDb();
    meta = await createPGliteDb();
    dataDb = data.db as unknown as Kysely<DynamicDB>;
    metaDb = meta.db as unknown as Kysely<DynamicDB>;
    for (const fixture of [data, meta]) {
      await fixture.pglite.exec(`
        CREATE TABLE attachments_table (
          id text PRIMARY KEY,
          attachment_id text,
          token text,
          name text,
          table_id text,
          record_id text,
          field_id text
        )
      `);
    }
  });

  beforeEach(async () => {
    await data.pglite.exec('TRUNCATE attachments_table');
    await meta.pglite.exec('TRUNCATE attachments_table');
  });

  afterAll(async () => {
    await data.db.destroy();
    await meta.db.destroy();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('advances raw-row keysets past a fully invalid page and returns every later ref', async () => {
    await insertAttachmentFixtures(data, [
      attachmentRefFixture('d06'),
      attachmentRefFixture('d01', { token: null }),
      attachmentRefFixture('d04'),
      attachmentRefFixture('d00', { token: null }),
      attachmentRefFixture('d02'),
      attachmentRefFixture('d05'),
      attachmentRefFixture('d03'),
      attachmentRefFixture('d07', { table_id: 'tbl_excluded' }),
    ]);

    const pages = [];
    for await (const page of iterateAttachmentTableRefs(
      dataDb,
      metaDb,
      { tableIds: ['tbl_1'] },
      { pageSize: 2 }
    )) {
      pages.push(page);
    }

    expect(pages.map((page) => page.map((ref) => ref.id))).toEqual([
      ['d02', 'd03'],
      ['d04', 'd05'],
      ['d06'],
    ]);
    expect(
      pages
        .flat()
        .map((ref) => [
          ref.id,
          ref.attachmentId,
          ref.token,
          ref.name,
          ref.tableId,
          ref.recordId,
          ref.fieldId,
        ])
    ).toEqual([
      ['d02', 'act_d02', 'tok_d02', 'd02.txt', 'tbl_1', 'rec_d02', 'fld_1'],
      ['d03', 'act_d03', 'tok_d03', 'd03.txt', 'tbl_1', 'rec_d03', 'fld_1'],
      ['d04', 'act_d04', 'tok_d04', 'd04.txt', 'tbl_1', 'rec_d04', 'fld_1'],
      ['d05', 'act_d05', 'tok_d05', 'd05.txt', 'tbl_1', 'rec_d05', 'fld_1'],
      ['d06', 'act_d06', 'tok_d06', 'd06.txt', 'tbl_1', 'rec_d06', 'fld_1'],
    ]);
  });

  it('shadows every old attachment for a replaced cell across meta pages and preserves legacy cells', async () => {
    await insertAttachmentFixtures(data, [
      attachmentRefFixture('d03', { record_id: 'rec_replaced' }),
      attachmentRefFixture('d01', { record_id: 'rec_replaced' }),
      attachmentRefFixture('d02'),
    ]);
    await insertAttachmentFixtures(meta, [
      attachmentRefFixture('m00a', { token: null }),
      attachmentRefFixture('m00b', { token: null }),
      attachmentRefFixture('m06'),
      attachmentRefFixture('m03', { record_id: 'rec_replaced' }),
      attachmentRefFixture('m01', { record_id: 'rec_replaced' }),
      attachmentRefFixture('m05', { record_id: 'rec_replaced', table_id: 'tbl_2' }),
      attachmentRefFixture('m02', { record_id: 'rec_replaced' }),
      attachmentRefFixture('m04', { record_id: 'rec_replaced', field_id: 'fld_2' }),
    ]);

    const pages = [];
    for await (const page of iterateAttachmentTableRefs(
      dataDb,
      metaDb,
      { tableIds: ['tbl_1', 'tbl_2'] },
      { pageSize: 2 }
    )) {
      pages.push(page);
    }

    expect(pages.map((page) => page.map((ref) => ref.id))).toEqual([
      ['d01', 'd02'],
      ['d03'],
      ['m04'],
      ['m05', 'm06'],
    ]);
    expect(
      pages.flat().map((ref) => [ref.id, ref.token, ref.tableId, ref.recordId, ref.fieldId])
    ).toEqual([
      ['d01', 'tok_d01', 'tbl_1', 'rec_replaced', 'fld_1'],
      ['d02', 'tok_d02', 'tbl_1', 'rec_d02', 'fld_1'],
      ['d03', 'tok_d03', 'tbl_1', 'rec_replaced', 'fld_1'],
      ['m04', 'tok_m04', 'tbl_1', 'rec_replaced', 'fld_2'],
      ['m05', 'tok_m05', 'tbl_2', 'rec_replaced', 'fld_1'],
      ['m06', 'tok_m06', 'tbl_1', 'rec_m06', 'fld_1'],
    ]);
    const legacyRows = await listAttachmentTableRefs(dataDb, metaDb, {
      tableIds: ['tbl_1', 'tbl_2'],
    });
    expect(pages.flat()).toEqual(legacyRows.sort((left, right) => left.id.localeCompare(right.id)));
  });

  it('does not revive an old meta attachment when its data replacement is outside the attachment-id filter', async () => {
    await insertAttachmentFixtures(data, [
      attachmentRefFixture('new', { record_id: 'rec_replaced', attachment_id: 'act_new' }),
    ]);
    await insertAttachmentFixtures(meta, [
      attachmentRefFixture('m01', { record_id: 'rec_replaced', attachment_id: 'act_old' }),
      attachmentRefFixture('m02', { attachment_id: 'act_legacy' }),
      attachmentRefFixture('m03', { attachment_id: 'act_excluded' }),
    ]);

    const refs = [];
    for await (const page of iterateAttachmentTableRefs(
      dataDb,
      metaDb,
      { attachmentIds: ['act_old', 'act_legacy'] },
      { pageSize: 1 }
    )) {
      refs.push(...page);
    }

    expect(refs).toEqual([
      {
        id: 'm02',
        attachmentId: 'act_legacy',
        token: 'tok_m02',
        name: 'm02.txt',
        tableId: 'tbl_1',
        recordId: 'rec_m02',
        fieldId: 'fld_1',
      },
    ]);
  });

  it('returns same-db refs once across multiple pages', async () => {
    await insertAttachmentFixtures(data, [
      attachmentRefFixture('s03'),
      attachmentRefFixture('s01'),
      attachmentRefFixture('s02'),
    ]);

    const pages = [];
    for await (const page of iterateAttachmentTableRefs(
      dataDb,
      dataDb,
      { tableIds: ['tbl_1'] },
      { pageSize: 1 }
    )) {
      pages.push(page);
    }

    expect(pages.map((page) => page.map((ref) => [ref.id, ref.attachmentId, ref.token]))).toEqual([
      [['s01', 'act_s01', 'tok_s01']],
      [['s02', 'act_s02', 'tok_s02']],
      [['s03', 'act_s03', 'tok_s03']],
    ]);
  });

  it('only reads when demanded and stops querying both databases after early consumer return', async () => {
    await insertAttachmentFixtures(data, [
      attachmentRefFixture('s01'),
      attachmentRefFixture('s02'),
    ]);
    await insertAttachmentFixtures(meta, [attachmentRefFixture('legacy')]);
    const dataReads = vi.spyOn(data.pglite, 'query');
    const metaReads = vi.spyOn(meta.pglite, 'query');
    const iterator = iterateAttachmentTableRefs(
      dataDb,
      metaDb,
      { tableIds: ['tbl_1'] },
      { pageSize: 1 }
    );
    expect(dataReads).not.toHaveBeenCalled();
    expect(metaReads).not.toHaveBeenCalled();

    expect(await iterator.next()).toEqual({
      done: false,
      value: [
        {
          id: 's01',
          attachmentId: 'act_s01',
          token: 'tok_s01',
          name: 's01.txt',
          tableId: 'tbl_1',
          recordId: 'rec_s01',
          fieldId: 'fld_1',
        },
      ],
    });
    expect(dataReads).toHaveBeenCalledTimes(1);
    expect(metaReads).not.toHaveBeenCalled();
    await iterator.return();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(dataReads).toHaveBeenCalledTimes(1);
    expect(metaReads).not.toHaveBeenCalled();
  });

  it('does not query either database after an abort between pages', async () => {
    await insertAttachmentFixtures(data, [
      attachmentRefFixture('s01'),
      attachmentRefFixture('s02'),
    ]);
    const dataReads = vi.spyOn(data.pglite, 'query');
    const metaReads = vi.spyOn(meta.pglite, 'query');
    const controller = new AbortController();
    const iterator = iterateAttachmentTableRefs(
      dataDb,
      metaDb,
      { tableIds: ['tbl_1'] },
      { pageSize: 1, signal: controller.signal }
    );
    const first = await iterator.next();
    expect(first.value).toMatchObject([{ id: 's01', token: 'tok_s01' }]);
    const reason = new Error('attachment iteration canceled');
    controller.abort(reason);
    await expect(iterator.next()).rejects.toBe(reason);
    expect(dataReads).toHaveBeenCalledTimes(1);
    expect(metaReads).not.toHaveBeenCalled();
  });

  it.each(['data', 'meta'] as const)(
    'does not yield or read further when aborted during the awaited %s query',
    async (source) => {
      await insertAttachmentFixtures(source === 'data' ? data : meta, [
        attachmentRefFixture('s01'),
        attachmentRefFixture('s02'),
      ]);
      const controller = new AbortController();
      const reason = new Error(`canceled during ${source} query`);
      const canceledDb = (source === 'data' ? dataDb : metaDb).withPlugin({
        transformQuery: ({ node }) => node,
        transformResult: async ({ result }) => {
          controller.abort(reason);
          return result;
        },
      });
      const dataReads = vi.spyOn(data.pglite, 'query');
      const metaReads = vi.spyOn(meta.pglite, 'query');
      const iterator = iterateAttachmentTableRefs(
        source === 'data' ? canceledDb : dataDb,
        source === 'meta' ? canceledDb : metaDb,
        { tableIds: ['tbl_1'] },
        { pageSize: 1, signal: controller.signal }
      );

      await expect(iterator.next()).rejects.toBe(reason);
      expect(dataReads).toHaveBeenCalledTimes(1);
      expect(metaReads).toHaveBeenCalledTimes(source === 'meta' ? 1 : 0);
    }
  );

  it('does not read for empty filters or an already aborted signal', async () => {
    const dataReads = vi.spyOn(data.pglite, 'query');
    const metaReads = vi.spyOn(meta.pglite, 'query');
    const empty = iterateAttachmentTableRefs(dataDb, metaDb, {
      tableIds: [],
      attachmentIds: [],
    });
    expect(await empty.next()).toEqual({ done: true, value: undefined });
    const controller = new AbortController();
    const reason = new Error('already canceled');
    controller.abort(reason);
    const aborted = iterateAttachmentTableRefs(
      dataDb,
      metaDb,
      { tableIds: ['tbl_1'] },
      { signal: controller.signal }
    );
    await expect(aborted.next()).rejects.toBe(reason);
    expect(dataReads).not.toHaveBeenCalled();
    expect(metaReads).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects page size %s without reading',
    async (pageSize) => {
      const dataReads = vi.spyOn(data.pglite, 'query');
      const metaReads = vi.spyOn(meta.pglite, 'query');
      const iterator = iterateAttachmentTableRefs(
        dataDb,
        metaDb,
        { tableIds: ['tbl_1'] },
        { pageSize }
      );
      await expect(iterator.next()).rejects.toThrow(RangeError);
      expect(dataReads).not.toHaveBeenCalled();
      expect(metaReads).not.toHaveBeenCalled();
    }
  );
});

describe('attachmentTableQueries (T7247)', () => {
  it('reads attachments_table refs from the data db when meta and data are the same', async () => {
    const db = createSelectDb([
      {
        id: 'attt1',
        attachment_id: 'act_1',
        token: 'tok_data',
        name: 'file.txt',
        table_id: 'tbl_1',
        record_id: 'rec_1',
        field_id: 'fld_1',
      },
    ]);

    const rows = await listAttachmentTableRefs(db as never, db as never, {
      tableIds: ['tbl_1'],
    });

    expect(db.selectFrom).toHaveBeenCalledTimes(1);
    expect(db.selectFrom).toHaveBeenCalledWith('attachments_table');
    expect(rows).toEqual([
      {
        id: 'attt1',
        attachmentId: 'act_1',
        token: 'tok_data',
        name: 'file.txt',
        tableId: 'tbl_1',
        recordId: 'rec_1',
        fieldId: 'fld_1',
      },
    ]);
  });

  it('unions data-db post-bind refs with leftover meta-db pre-bind refs', async () => {
    const dataDb = createSelectDb([
      {
        id: 'attt_data',
        attachment_id: 'act_new',
        token: 'tok_new',
        name: 'new.txt',
        table_id: 'tbl_1',
        record_id: 'rec_new',
        field_id: 'fld_1',
      },
    ]);
    const metaDb = createSelectDb([
      {
        id: 'attt_meta',
        attachment_id: 'act_old',
        token: 'tok_old',
        name: 'old.txt',
        table_id: 'tbl_1',
        record_id: 'rec_old',
        field_id: 'fld_1',
      },
      {
        id: 'attt_data',
        attachment_id: 'act_new',
        token: 'tok_new',
        name: 'new.txt',
        table_id: 'tbl_1',
        record_id: 'rec_new',
        field_id: 'fld_1',
      },
    ]);

    const rows = await listAttachmentTableRefs(dataDb as never, metaDb as never, {
      tableIds: ['tbl_1'],
    });

    expect(dataDb.selectFrom).toHaveBeenCalledWith('attachments_table');
    expect(metaDb.selectFrom).toHaveBeenCalledWith('attachments_table');
    expect(rows).toEqual([
      {
        id: 'attt_data',
        attachmentId: 'act_new',
        token: 'tok_new',
        name: 'new.txt',
        tableId: 'tbl_1',
        recordId: 'rec_new',
        fieldId: 'fld_1',
      },
      {
        id: 'attt_meta',
        attachmentId: 'act_old',
        token: 'tok_old',
        name: 'old.txt',
        tableId: 'tbl_1',
        recordId: 'rec_old',
        fieldId: 'fld_1',
      },
    ]);
  });

  it('drops leftover meta refs for a cell that already has data-db rows after rewrite', async () => {
    const dataDb = createSelectDb([
      {
        id: 'attt_new',
        attachment_id: 'act_new',
        token: 'tok_new',
        name: 'new.txt',
        table_id: 'tbl_1',
        record_id: 'rec_1',
        field_id: 'fld_1',
      },
    ]);
    const metaDb = createSelectDb([
      {
        id: 'attt_old',
        attachment_id: 'act_old',
        token: 'tok_old',
        name: 'old.txt',
        table_id: 'tbl_1',
        record_id: 'rec_1',
        field_id: 'fld_1',
      },
    ]);

    const rows = await listAttachmentTableRefs(dataDb as never, metaDb as never, {
      tableIds: ['tbl_1'],
    });

    expect(rows).toEqual([
      {
        id: 'attt_new',
        attachmentId: 'act_new',
        token: 'tok_new',
        name: 'new.txt',
        tableId: 'tbl_1',
        recordId: 'rec_1',
        fieldId: 'fld_1',
      },
    ]);
    expect(
      await listAttachmentTokensByTableIds(dataDb as never, metaDb as never, ['tbl_1'])
    ).toEqual(['tok_new']);
  });

  it('deletes attachments_table rows from both dbs when they are split', async () => {
    const dataDb = createDeleteDb();
    const metaDb = createDeleteDb();

    await deleteAttachmentTableRefsByRecordIds(dataDb as never, metaDb as never, 'tbl_1', [
      'rec_1',
    ]);

    expect(dataDb.deleteFrom).toHaveBeenCalledWith('attachments_table');
    expect(metaDb.deleteFrom).toHaveBeenCalledWith('attachments_table');
    expect(dataDb.execute).toHaveBeenCalled();
    expect(metaDb.execute).toHaveBeenCalled();
  });
  it('deletes attachments_table rows for field ids from both dbs when they are split', async () => {
    const dataDb = createDeleteDb();
    const metaDb = createDeleteDb();

    await deleteAttachmentTableRefsByFieldIds(dataDb as never, metaDb as never, 'tbl_1', ['fld_1']);

    expect(dataDb.deleteFrom).toHaveBeenCalledWith('attachments_table');
    expect(metaDb.deleteFrom).toHaveBeenCalledWith('attachments_table');
    expect(dataDb.execute).toHaveBeenCalled();
    expect(metaDb.execute).toHaveBeenCalled();
  });

  it('skips field-reference deletion when there are no field ids', async () => {
    const db = createDeleteDb();

    await deleteAttachmentTableRefsByFieldIds(db as never, db as never, 'tbl_1', []);

    expect(db.deleteFrom).not.toHaveBeenCalled();
  });
});
