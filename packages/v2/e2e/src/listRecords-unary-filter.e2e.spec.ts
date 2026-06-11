/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 listRecords unary filter operators (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let statusFieldId: string;

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listRecordsWithFilter = async (filter: unknown) => {
    await drainOutbox();

    const params = new URLSearchParams({
      tableId,
      fieldKeyType: FieldKeyType.Id,
      filter: JSON.stringify(filter),
    });

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });

    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }

    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }

    return parsed.data.data.records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'V2 Unary Filter Table',
      fields: [
        { name: 'Name', type: 'singleLineText', isPrimary: true },
        { name: 'Status', type: 'singleSelect', options: ['Day0 sent', 'Pending'] },
      ],
      views: [{ type: 'grid' }],
    });

    tableId = table.id;

    const nameFieldId = table.fields.find((field) => field.isPrimary)?.id ?? '';
    statusFieldId = table.fields.find((field) => field.name === 'Status')?.id ?? '';

    if (!nameFieldId || !statusFieldId) {
      throw new Error('Required field ids not found');
    }

    await ctx.createRecord(tableId, {
      [nameFieldId]: 'Has Status',
      [statusFieldId]: 'Day0 sent',
    });
    await ctx.createRecord(tableId, {
      [nameFieldId]: 'No Status',
    });
  }, 30000);

  it('supports isNotEmpty without explicit value', async () => {
    const records = await listRecordsWithFilter({
      fieldId: statusFieldId,
      operator: 'isNotEmpty',
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.fields?.[statusFieldId]).toBe('Day0 sent');
  });

  it('supports isEmpty without explicit value', async () => {
    const records = await listRecordsWithFilter({
      fieldId: statusFieldId,
      operator: 'isEmpty',
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.fields?.[statusFieldId] ?? null).toBeNull();
  });
});
