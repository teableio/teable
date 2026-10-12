import { describe, expect, it, vi } from 'vitest';

import {
  deleteAttachmentTableRefsByRecordIds,
  listAttachmentTableRefs,
  listAttachmentTokensByTableIds,
} from './attachmentTableQueries';

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
});
