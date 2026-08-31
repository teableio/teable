/* eslint-disable @typescript-eslint/naming-convention */
import { updateRecordOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E tests for the v1 empty-value normalization contract (T6520).
 *
 * v1 never stores "empty" scalar inputs verbatim: clearing a cell with
 * false (checkbox), "" (text) or [] (multi-value fields) is stored as null,
 * so reads return the cell as empty. v2 must behave the same on both the
 * strict and typecast write paths.
 */
describe('v2 record empty value normalization (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let longTextFieldId: string;
  let checkboxFieldId: string;
  let multiSelectFieldId: string;
  let userFieldId: string;
  let attachmentFieldId: string;
  let linkFieldId: string;
  let foreignTableId: string;
  let foreignRecordId: string;

  const expectEmpty = (value: unknown) => {
    // stored null may surface as null or an absent key depending on serializer
    expect(value == null).toBe(true);
  };

  const readRecord = async (recordId: string) => {
    const records = await ctx.listRecords(tableId);
    const record = records.find((r) => r.id === recordId);
    expect(record).toBeDefined();
    return record!;
  };

  const updateWithTypecast = async (recordId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordId, typecast: true, fields }),
    });
    expect(response.status).toBe(200);
    const parsed = updateRecordOkResponseSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Empty Norm Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    foreignTableId = foreignTable.id;
    const foreignNameFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
    const foreignRecord = await ctx.createRecord(foreignTableId, {
      [foreignNameFieldId]: 'Target',
    });
    foreignRecordId = foreignRecord.id;

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Empty Norm Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'longText', name: 'Notes' },
        { type: 'checkbox', name: 'Done' },
        { type: 'multipleSelect', name: 'Tags', options: ['Tag A', 'Tag B'] },
        { type: 'user', name: 'Team', options: { isMultiple: true, shouldNotify: false } },
        { type: 'attachment', name: 'Files' },
        {
          type: 'link',
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    longTextFieldId = table.fields.find((f) => f.name === 'Notes')?.id ?? '';
    checkboxFieldId = table.fields.find((f) => f.name === 'Done')?.id ?? '';
    multiSelectFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';
    userFieldId = table.fields.find((f) => f.name === 'Team')?.id ?? '';
    attachmentFieldId = table.fields.find((f) => f.name === 'Files')?.id ?? '';
    linkFieldId = table.fields.find((f) => f.name === 'Related')?.id ?? '';
  });

  it('stores false as null when resetting a checkbox (v1 record.e2e "use false to reset checkbox field")', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'checkbox reset',
      [checkboxFieldId]: true,
    });
    expect(record.fields[checkboxFieldId]).toBe(true);

    await ctx.updateRecord(tableId, record.id, { [checkboxFieldId]: false });

    const updated = await readRecord(record.id);
    expectEmpty(updated.fields[checkboxFieldId]);
  });

  it('stores "" as null when clearing singleLineText', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'text clear',
    });
    await ctx.updateRecord(tableId, record.id, { [primaryFieldId]: '' });

    const updated = await readRecord(record.id);
    expectEmpty(updated.fields[primaryFieldId]);
  });

  it('stores "" as null when clearing longText', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'longtext clear',
      [longTextFieldId]: 'some notes',
    });
    await ctx.updateRecord(tableId, record.id, { [longTextFieldId]: '' });

    const updated = await readRecord(record.id);
    expectEmpty(updated.fields[longTextFieldId]);
  });

  it('stores [] as null when clearing multipleSelect', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'multiselect clear',
      [multiSelectFieldId]: ['Tag A'],
    });
    await ctx.updateRecord(tableId, record.id, { [multiSelectFieldId]: [] });

    const updated = await readRecord(record.id);
    expectEmpty(updated.fields[multiSelectFieldId]);
  });

  it('stores [] as null when clearing a multi-value user field', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'user clear',
    });
    await ctx.updateRecord(tableId, record.id, { [userFieldId]: [] });

    const updated = await readRecord(record.id);
    expectEmpty(updated.fields[userFieldId]);
  });

  it('stores [] as null when clearing an attachment field', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'attachment clear',
    });
    await ctx.updateRecord(tableId, record.id, { [attachmentFieldId]: [] });

    const updated = await readRecord(record.id);
    expectEmpty(updated.fields[attachmentFieldId]);
  });

  it('stores [] as null when clearing a link field', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'link clear',
      [linkFieldId]: [{ id: foreignRecordId }],
    });
    await ctx.updateRecord(tableId, record.id, { [linkFieldId]: [] });

    const updated = await readRecord(record.id);
    const value = updated.fields[linkFieldId];
    expect(value == null || (Array.isArray(value) && value.length === 0)).toBe(true);
    if (Array.isArray(value)) {
      // even if serialized as an array, storage must not keep a stale item
      expect(value).toEqual([]);
    }
  });

  it('normalizes empty values on record creation as well', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'create with empties',
      [checkboxFieldId]: false,
      [longTextFieldId]: '',
      [multiSelectFieldId]: [],
    });

    const created = await readRecord(record.id);
    expectEmpty(created.fields[checkboxFieldId]);
    expectEmpty(created.fields[longTextFieldId]);
    expectEmpty(created.fields[multiSelectFieldId]);
  });

  it('normalizes empty values on the typecast write path (v1 record-typecast "" → null)', async () => {
    const record = await ctx.createRecord(tableId, {
      [primaryFieldId]: 'typecast empties',
      [checkboxFieldId]: true,
      [longTextFieldId]: 'notes',
    });

    await updateWithTypecast(record.id, {
      [checkboxFieldId]: 'false',
      [longTextFieldId]: '',
    });

    const updated = await readRecord(record.id);
    expectEmpty(updated.fields[checkboxFieldId]);
    expectEmpty(updated.fields[longTextFieldId]);
  });
});
