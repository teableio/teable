/* eslint-disable @typescript-eslint/naming-convention */
import { deleteRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

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
});
