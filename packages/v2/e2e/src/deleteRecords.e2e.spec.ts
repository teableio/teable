/* eslint-disable @typescript-eslint/naming-convention */
import { deleteRecordsOkResponseSchema } from '@teable/v2-contract-http';
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
});
