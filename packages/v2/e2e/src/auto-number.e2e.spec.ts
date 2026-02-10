/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordErrorResponseSchema,
  createFieldOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 auto-number continuity (e2e)', () => {
  let ctx: SharedTestContext;
  let tableCounter = 0;

  const uniqueTableName = (prefix: string) => {
    tableCounter += 1;
    return `${prefix}-${tableCounter}-${Date.now()}`;
  };

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await response.json();
    expect(response.status).toBe(201);
    return raw.data.table;
  };

  const createField = async (tableId: string, field: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        field,
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    const parsed = createFieldOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) throw new Error('Failed to create field');
    const created = parsed.data.data.table.fields.find(
      (entry: { name: string; id: string }) => entry.name === field.name || entry.id === field.id
    );
    return created;
  };

  const createRecordRaw = async (
    tableId: string,
    fields: Record<string, unknown>,
    expectedStatus: number = 201
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields,
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(expectedStatus);
    return raw;
  };

  const listRecords = async (tableId: string) => {
    await ctx.drainOutbox();
    const params = new URLSearchParams({ tableId });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    return raw.data;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('when record creation fails due to notNull constraint', () => {
    it('should reject null for notNull field with validation error (not DB constraint)', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('auto-number-notnull'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const tableId = table.id;

      // Add a notNull field
      const requiredField = await createField(tableId, {
        type: 'singleLineText',
        name: 'Required',
        notNull: true,
      });

      // Get initial state
      const before = await listRecords(tableId);
      const beforeCount = before.pagination.total;

      // Attempt to create a record with null for the required field — should fail with 400
      const failedRaw = await createRecordRaw(tableId, { [requiredField.id]: null }, 400);
      const parsed = createRecordErrorResponseSchema.safeParse(failedRaw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        // Must be caught at validation layer (not_null), not DB constraint
        expect(parsed.data.error.code).toBe('validation.field.not_null');
      }

      // Verify no record was created by the failed attempt
      const afterFail = await listRecords(tableId);
      expect(afterFail.pagination.total).toBe(beforeCount);

      // Create a valid record — should succeed
      const okRaw = await createRecordRaw(tableId, {
        [requiredField.id]: 'ok',
      });
      expect(okRaw.ok).toBe(true);

      // Verify exactly one new record
      const afterOk = await listRecords(tableId);
      expect(afterOk.pagination.total).toBe(beforeCount + 1);
    });

    it('should reject null for notNull field on update', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('auto-number-notnull-update'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const tableId = table.id;

      // Add a notNull field
      const requiredField = await createField(tableId, {
        type: 'singleLineText',
        name: 'Required',
        notNull: true,
      });

      // Create a valid record
      const createRaw = await createRecordRaw(tableId, {
        [requiredField.id]: 'initial',
      });
      const recordId = createRaw.data.record.id;

      // Try to update with null — should fail
      const updateResponse = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          recordId,
          fields: { [requiredField.id]: null },
          fieldKeyType: FieldKeyType.Id,
        }),
      });
      expect(updateResponse.status).toBe(400);
      const updateRaw = await updateResponse.json();
      expect(updateRaw.error?.code).toMatch(/validation\.field\.(not_null|invalid_value)/);
    });
  });
});
