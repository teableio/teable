/* eslint-disable @typescript-eslint/naming-convention */
import { deleteRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import { executeUndo } from './undo-redo/shared/undoRedoE2eTestKit';

const linkRecordIds = (value: unknown): string[] => {
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) =>
    item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? [item.id] : []
  );
};

describe('v2 http deleteRecords (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Delete Records Table',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;
    primaryFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
  });

  it('deletes multiple existing records and treats missing IDs as success', async () => {
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'r1' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'r2' });

    const before = await ctx.listRecords(tableId, { limit: 1000 });
    expect(before.some((r) => r.id === r1.id)).toBe(true);
    expect(before.some((r) => r.id === r2.id)).toBe(true);

    const missingRecordId = `rec${'x'.repeat(16)}`;

    await ctx.deleteRecords(tableId, [r1.id, r2.id, missingRecordId]);

    const after = await ctx.listRecords(tableId, { limit: 1000 });
    expect(after.some((r) => r.id === r1.id)).toBe(false);
    expect(after.some((r) => r.id === r2.id)).toBe(false);
  });

  it('treats a repeated delete of an already removed record as success', async () => {
    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'delete twice' });
    await ctx.deleteRecords(tableId, [record.id]);

    const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordIds: [record.id] }),
    });

    expect(response.status).toBe(200);
    const rawBody = await response.json();
    const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(true);
      expect(parsed.data.data.deletedRecordIds).toEqual([]);
    }
  });

  it('Y3901 deletes by filter, returns committed count and exact survivors, then repeats with zero', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Conditional Delete Facts',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleId = table.fields.find((field) => field.isPrimary)!.id;
    const removed = await ctx.createRecord(table.id, { [titleId]: 'remove' });
    const survivor = await ctx.createRecord(table.id, { [titleId]: 'keep' });
    const request = () =>
      fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          filter: { fieldId: titleId, operator: 'is', value: 'remove' },
        }),
      });

    const first = await request();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, data: { deletedCount: 1 } });
    expect((await ctx.listRecords(table.id)).map((row) => row.id)).toEqual([survivor.id]);
    expect((await ctx.listRecords(table.id)).some((row) => row.id === removed.id)).toBe(false);

    const repeat = await request();
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ ok: true, data: { deletedCount: 0 } });
    expect((await ctx.listRecords(table.id)).map((row) => row.id)).toEqual([survivor.id]);
  });

  it('Y3901 deletes 1205 matching rows beyond the read page and retains two exact survivors', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Conditional Delete Beyond Read Page',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleId = table.fields.find((field) => field.isPrimary)!.id;
    const created = await ctx.createRecords(table.id, [
      ...Array.from({ length: 1205 }, () => ({ fields: { [titleId]: 'remove' } })),
      { fields: { [titleId]: 'keep-a' } },
      { fields: { [titleId]: 'keep-b' } },
    ]);
    const survivors = created
      .slice(-2)
      .map((row) => row.id)
      .sort();
    expect(survivors).toHaveLength(2);
    for (const deletedCount of [1205, 0]) {
      const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          filter: { fieldId: titleId, operator: 'is', value: 'remove' },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, data: { deletedCount } });
      expect(
        (await ctx.listRecords(table.id, { limit: 1000 })).map((row) => row.id).sort()
      ).toEqual(survivors);
    }
  });

  /**
   * Y3906: a conditional delete can select both sides of an optional self
   * manyOne relationship (A -> B). One undo must restore the original stored
   * relationship, not the cleanup-mutated one.
   */
  it('Y3906 restores the original self-link relationship after a conditional delete of both sides and one undo', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Conditional Delete Self Link Restore ${Date.now()}`,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Status' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleId = table.fields.find((field) => field.isPrimary)!.id;
    const statusId = table.fields.find((field) => field.name === 'Status')!.id;

    const withLink = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'link',
        name: 'Parent',
        options: {
          relationship: 'manyOne',
          foreignTableId: table.id,
          lookupFieldId: titleId,
          isOneWay: false,
        },
      },
    });
    const parentFieldId = withLink.fields.find((field) => field.name === 'Parent')!.id;
    const reloadedTable = await ctx.getTableById(table.id);
    const childrenFieldId = reloadedTable.fields.find(
      (field) => field.type === 'link' && field.id !== parentFieldId
    )!.id;

    const target = await ctx.createRecord(table.id, { [titleId]: 'Target', [statusId]: 'remove' });
    const source = await ctx.createRecord(table.id, {
      [titleId]: 'Source',
      [statusId]: 'remove',
      [parentFieldId]: { id: target.id },
    });
    const survivor = await ctx.createRecord(table.id, {
      [titleId]: 'Survivor',
      [statusId]: 'keep',
    });

    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', table.id)
      .executeTakeFirstOrThrow();
    const fieldMeta = await ctx.testContainer.db
      .selectFrom('field')
      .select(['options', 'db_field_name'])
      .where('id', '=', parentFieldId)
      .executeTakeFirstOrThrow();
    const rawLinkOptions: unknown = fieldMeta.options;
    const linkOptions = (
      typeof rawLinkOptions === 'string' ? JSON.parse(rawLinkOptions) : rawLinkOptions
    ) as { foreignKeyName?: string } | null;
    const fkColumn = linkOptions?.foreignKeyName ?? '';
    const displayColumn = fieldMeta.db_field_name;
    if (!fkColumn || !displayColumn) {
      throw new Error(`Missing stored link columns for ${parentFieldId}`);
    }
    const readStoredLink = async (recordId: string) => {
      const result = await sql<{ fk: unknown; cell: unknown }>`
        SELECT ${sql.ref(fkColumn)} AS fk, ${sql.ref(displayColumn)} AS cell
        FROM ${sql.table(tableMeta.db_table_name)}
        WHERE ${sql.ref('__id')} = ${recordId}
      `.execute(ctx.testContainer.db);
      expect(result.rows).toHaveLength(1);
      return result.rows[0]!;
    };

    const before = await ctx.listRecords(table.id, { limit: 1000 });
    const originalSourceCell = before.find((row) => row.id === source.id)!.fields[parentFieldId];
    const originalTargetCell = before.find((row) => row.id === target.id)!.fields[childrenFieldId];
    const originalStored = await readStoredLink(source.id);
    expect(linkRecordIds(originalSourceCell)).toEqual([target.id]);
    expect(linkRecordIds(originalTargetCell)).toEqual([source.id]);
    expect(originalStored.fk).toBe(target.id);
    expect(originalStored.cell).not.toBeNull();

    const deleteByStatus = () =>
      fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          filter: { fieldId: statusId, operator: 'is', value: 'remove' },
        }),
      });

    const first = await deleteByStatus();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, data: { deletedCount: 2 } });
    expect((await ctx.listRecords(table.id, { limit: 1000 })).map((row) => row.id)).toEqual([
      survivor.id,
    ]);

    const repeat = await deleteByStatus();
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ ok: true, data: { deletedCount: 0 } });
    expect((await ctx.listRecords(table.id, { limit: 1000 })).map((row) => row.id)).toEqual([
      survivor.id,
    ]);

    await executeUndo(ctx, table.id);

    const restored = await ctx.listRecords(table.id, { limit: 1000 });
    expect(restored.map((row) => row.id).sort()).toEqual(
      [source.id, target.id, survivor.id].sort()
    );
    const restoredSource = restored.find((row) => row.id === source.id)!;
    const restoredTarget = restored.find((row) => row.id === target.id)!;
    expect(restoredSource.fields[parentFieldId]).toEqual(originalSourceCell);
    expect(restoredTarget.fields[childrenFieldId]).toEqual(originalTargetCell);
    expect(await readStoredLink(source.id)).toEqual(originalStored);
  });

  /**
   * Y3906: the one-way variant has no symmetric field to repair a lost link, so
   * the restored stored cell and FK can only come from the delete snapshot.
   */
  it('Y3906 restores the original one-way self manyOne link after a conditional delete of both sides and one undo', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Conditional Delete One Way Self Link Restore ${Date.now()}`,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Status' },
      ],
      views: [{ type: 'grid' }],
    });
    const titleId = table.fields.find((field) => field.isPrimary)!.id;
    const statusId = table.fields.find((field) => field.name === 'Status')!.id;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'link',
        name: 'Parent',
        options: {
          relationship: 'manyOne',
          foreignTableId: table.id,
          lookupFieldId: titleId,
          isOneWay: true,
        },
      },
    });
    const reloaded = await ctx.getTableById(table.id);
    const parentFieldId = reloaded.fields.find((field) => field.name === 'Parent')!.id;
    expect(
      reloaded.fields.filter((field) => field.type === 'link').map((field) => field.id)
    ).toEqual([parentFieldId]);

    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', table.id)
      .executeTakeFirstOrThrow();
    const fieldMeta = await ctx.testContainer.db
      .selectFrom('field')
      .select(['options', 'db_field_name'])
      .where('id', '=', parentFieldId)
      .executeTakeFirstOrThrow();
    const rawLinkOptions: unknown = fieldMeta.options;
    const linkOptions = (
      typeof rawLinkOptions === 'string' ? JSON.parse(rawLinkOptions) : rawLinkOptions
    ) as { foreignKeyName?: string } | null;
    const fkColumn = linkOptions?.foreignKeyName ?? '';
    const displayColumn = fieldMeta.db_field_name;
    if (!fkColumn || !displayColumn) {
      throw new Error(`Missing stored link columns for ${parentFieldId}`);
    }
    const readStoredLink = async (recordId: string) => {
      const result = await sql<{ fk: unknown; cell: unknown }>`
        SELECT ${sql.ref(fkColumn)} AS fk, ${sql.ref(displayColumn)} AS cell
        FROM ${sql.table(tableMeta.db_table_name)}
        WHERE ${sql.ref('__id')} = ${recordId}
      `.execute(ctx.testContainer.db);
      expect(result.rows).toHaveLength(1);
      return result.rows[0]!;
    };

    const target = await ctx.createRecord(table.id, { [titleId]: 'Target', [statusId]: 'remove' });
    const source = await ctx.createRecord(table.id, {
      [titleId]: 'Source',
      [statusId]: 'remove',
      [parentFieldId]: { id: target.id },
    });
    const survivor = await ctx.createRecord(table.id, {
      [titleId]: 'Survivor',
      [statusId]: 'keep',
    });

    const before = await ctx.listRecords(table.id, { limit: 1000 });
    const originalSourceCell = before.find((row) => row.id === source.id)!.fields[parentFieldId];
    const originalStored = await readStoredLink(source.id);
    expect(linkRecordIds(originalSourceCell)).toEqual([target.id]);
    expect(originalStored.fk).toBe(target.id);

    const deleteByStatus = () =>
      fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          filter: { fieldId: statusId, operator: 'is', value: 'remove' },
        }),
      });

    const first = await deleteByStatus();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, data: { deletedCount: 2 } });
    expect((await ctx.listRecords(table.id, { limit: 1000 })).map((row) => row.id)).toEqual([
      survivor.id,
    ]);

    const repeat = await deleteByStatus();
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ ok: true, data: { deletedCount: 0 } });

    await executeUndo(ctx, table.id);

    const restored = await ctx.listRecords(table.id, { limit: 1000 });
    expect(restored.map((row) => row.id).sort()).toEqual(
      [source.id, target.id, survivor.id].sort()
    );
    const restoredSource = restored.find((row) => row.id === source.id)!;
    expect(restoredSource.fields[parentFieldId]).toEqual(originalSourceCell);
    expect(await readStoredLink(source.id)).toEqual(originalStored);
  });

  it('Y3902 rejects missing, mixed, empty and malformed selectors without deleting rows', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Rejected Delete Selectors',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleId = table.fields.find((field) => field.isPrimary)!.id;
    const record = await ctx.createRecord(table.id, { [titleId]: 'preserve' });
    const filter = { fieldId: titleId, operator: 'is', value: 'preserve' };
    const before = await ctx.listRecords(table.id);
    for (const selector of [
      {},
      { recordIds: [record.id], filter },
      { recordIds: [], filter },
      { filter: null },
      { filter: {} },
      { filter: { conjunction: 'and', items: [] } },
      { filter: { conjunction: 'or', filterSet: [] } },
      { filter: { not: { conjunction: 'and', items: [] } } },
      { filter: { conjunction: 'and', filterSet: [filter, {}] } },
      { filter: { fieldId: titleId, operator: 'notAnOperator', value: 'preserve' } },
    ]) {
      const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, ...selector }),
      });
      expect(response.status, JSON.stringify(selector)).toBe(400);
      await response.text();
      expect(await ctx.listRecords(table.id), JSON.stringify(selector)).toEqual(before);
    }
  });

  it('Y3901 supports nested items, filterSet and not with exact committed deletion count', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Nested Conditional Delete',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleId = table.fields.find((field) => field.isPrimary)!.id;
    await ctx.createRecord(table.id, { [titleId]: 'remove-a' });
    await ctx.createRecord(table.id, { [titleId]: 'remove-b' });
    const survivor = await ctx.createRecord(table.id, { [titleId]: 'keep' });
    const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        filter: {
          conjunction: 'and',
          items: [
            { not: { fieldId: titleId, operator: 'is', value: 'keep' } },
            {
              conjunction: 'or',
              filterSet: [
                { fieldId: titleId, operator: 'is', value: 'remove-a' },
                { fieldId: titleId, operator: 'is', value: 'remove-b' },
              ],
            },
          ],
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { deletedCount: 2 } });
    expect((await ctx.listRecords(table.id)).map((row) => row.id)).toEqual([survivor.id]);
  });

  it('returns 400 for invalid input', async () => {
    const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId }),
    });

    expect(response.status).toBe(400);
  });

  it('returns ok response for batch delete', async () => {
    const r1 = await ctx.createRecord(tableId, { [primaryFieldId]: 'batch-1' });
    const r2 = await ctx.createRecord(tableId, { [primaryFieldId]: 'batch-2' });

    const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordIds: [r1.id, r2.id],
      }),
    });

    expect(response.status).toBe(200);
    const rawBody = await response.json();
    const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ok).toBe(true);
      expect(parsed.data.data.deletedRecordIds).toEqual([r1.id, r2.id]);
    }
  });

  /**
   * v1 reference: record.e2e-spec.ts:316 — a deleted record must no longer be
   * readable through getRecord (404 after delete).
   */
  it('returns 404 from getRecord after the record is deleted', async () => {
    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'to delete' });

    const getRecordStatus = async (recordId: string) => {
      const params = new URLSearchParams({ tableId, recordId });
      const response = await fetch(`${ctx.baseUrl}/tables/getRecord?${params.toString()}`, {
        method: 'GET',
      });
      await response.text();
      return response.status;
    };

    expect(await getRecordStatus(record.id)).toBe(200);

    await ctx.deleteRecords(tableId, [record.id]);

    expect(await getRecordStatus(record.id)).toBe(404);
  });

  /**
   * v1 reference: record.e2e-spec.ts:367 — creating a record right after a
   * delete must succeed (no stale row-order/index conflicts).
   */
  it('creates a record after deleting a record', async () => {
    const record = await ctx.createRecord(tableId, { [primaryFieldId]: 'delete then create' });
    await ctx.deleteRecords(tableId, [record.id]);

    const created = await ctx.createRecord(tableId, { [primaryFieldId]: 'created after delete' });
    expect(created.id).toMatch(/^rec/);

    const records = await ctx.listRecords(tableId, { limit: 1000 });
    expect(records.some((r) => r.id === record.id)).toBe(false);
    expect(records.some((r) => r.id === created.id)).toBe(true);
  });

  it('deletes a record when the undo capture trigger is disabled', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Delete Without Undo Capture ${Date.now()}`,
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const titleFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    const record = await ctx.createRecord(table.id, { [titleFieldId]: 'keep-delete' });

    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', table.id)
      .executeTakeFirst();
    const dbTableName = tableMeta?.db_table_name;
    if (!dbTableName) {
      throw new Error(`Missing db_table_name for ${table.id}`);
    }

    await sql`
      ALTER TABLE ${sql.table(dbTableName)}
      DISABLE TRIGGER "__teable_undo_capture"
    `.execute(ctx.testContainer.dataDb);

    try {
      await ctx.deleteRecords(table.id, [record.id]);
    } finally {
      await sql`
        ALTER TABLE ${sql.table(dbTableName)}
        ENABLE TRIGGER "__teable_undo_capture"
      `.execute(ctx.testContainer.dataDb);
    }

    const after = await ctx.listRecords(table.id, { limit: 1000 });
    expect(after.some((row) => row.id === record.id)).toBe(false);
  });

  it('[Y5650] rejects >20,000 explicit recordIds and restores multi-batch wide self-referential conditional deletes on undo', async () => {
    const oversizeIds = Array.from(
      { length: 20_001 },
      (_, index) => `rec${String(index).padStart(16, '0')}`
    );
    const oversizeRes = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordIds: oversizeIds }),
    });
    expect(oversizeRes.status).toBe(400);
    const oversizeBody = (await oversizeRes.json()) as {
      ok: boolean;
      error?: { code?: string };
    };
    expect(oversizeBody.ok).toBe(false);
    expect(oversizeBody.error?.code).toBe('validation.limit.records_per_mutation_max');

    const bulkTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Y5650 Wide SelfLink Delete ${Date.now()}`,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'longText', name: 'Notes' },
        { type: 'singleLineText', name: 'Tag' },
      ],
      views: [{ type: 'grid' }],
    });

    try {
      const titleId = bulkTable.fields.find((field) => field.isPrimary)!.id;
      const notesId = bulkTable.fields.find((field) => field.name === 'Notes')!.id;
      const tagId = bulkTable.fields.find((field) => field.name === 'Tag')!.id;

      await ctx.createField({
        baseId: ctx.baseId,
        tableId: bulkTable.id,
        field: {
          type: 'link',
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: bulkTable.id,
            lookupFieldId: titleId,
            isOneWay: false,
          },
        },
      });
      const withLink = await ctx.getTableById(bulkTable.id);
      const parentId = withLink.fields.find((field) => field.name === 'Parent')!.id;

      const totalRows = 250;
      const widePayload = 'w'.repeat(4_000);
      const created = await ctx.createRecords(
        bulkTable.id,
        Array.from({ length: totalRows }, (_, index) => ({
          fields: {
            [titleId]: `row-${index}`,
            [notesId]: widePayload,
            [tagId]: 'bulk',
          },
        }))
      );
      expect(created).toHaveLength(totalRows);

      const parentRecord = created[0]!;
      const childRecord = created[totalRows - 1]!;
      await ctx.updateRecord(bulkTable.id, childRecord.id, {
        [parentId]: { id: parentRecord.id },
      });

      const deleteRes = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: bulkTable.id,
          filter: { fieldId: tagId, operator: 'is', value: 'bulk' },
        }),
      });
      expect(deleteRes.status).toBe(200);
      expect(await deleteRes.json()).toMatchObject({
        ok: true,
        data: { deletedCount: totalRows },
      });

      expect(await ctx.listRecords(bulkTable.id, { limit: 10 })).toHaveLength(0);

      await executeUndo(ctx, bulkTable.id);
      const restored = await ctx.listRecords(bulkTable.id, { limit: 500 });
      expect(restored).toHaveLength(totalRows);
      const restoredChild = restored.find((row) => row.id === childRecord.id);
      expect(linkRecordIds(restoredChild?.fields[parentId])).toEqual([parentRecord.id]);
    } finally {
      await ctx.deleteTable(bulkTable.id, { mode: 'permanent' });
    }
  }, 120_000);
});
