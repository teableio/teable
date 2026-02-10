/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordErrorResponseSchema,
  createRecordsErrorResponseSchema,
  updateRecordErrorResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 constraint violation errors (P0)', () => {
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
    const created = raw.data.table.fields.find(
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

  const createRecordsRaw = async (
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>,
    expectedStatus: number = 201
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, records }),
    });
    const raw = await response.json();
    expect(response.status).toBe(expectedStatus);
    return raw;
  };

  const updateRecordRaw = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
    expectedStatus: number = 200
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId,
        fields,
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(expectedStatus);
    return raw;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('not-null constraint violations', () => {
    it('returns validation.field.not_null error on insert with null value', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('not-null-insert'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      await createField(table.id, {
        type: 'singleLineText',
        name: 'Required',
        notNull: true,
      });

      // Try to create record without providing value for notNull field
      const raw = await createRecordRaw(table.id, {}, 400);

      const parsed = createRecordErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        expect(parsed.data.error.code).toBe('validation.field.not_null');
        expect(parsed.data.error.tags).toContain('validation');
        expect(parsed.data.error.message).toContain('not-null');
      }
    });

    it('returns validation.field.not_null error on batch insert with null value', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('not-null-batch-insert'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      await createField(table.id, {
        type: 'singleLineText',
        name: 'Required',
        notNull: true,
      });

      // Try to create records without providing value for notNull field
      const raw = await createRecordsRaw(table.id, [{ fields: {} }], 400);

      const parsed = createRecordsErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        expect(parsed.data.error.code).toBe('validation.field.not_null');
        expect(parsed.data.error.tags).toContain('validation');
      }
    });

    it('returns validation error on update with null value for notNull field', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('not-null-update'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const requiredField = await createField(table.id, {
        type: 'singleLineText',
        name: 'Required',
        notNull: true,
      });

      // Create a record with value
      const createResponse = await createRecordRaw(table.id, {
        [requiredField.id]: 'initial value',
      });
      const recordId = createResponse.data.record.id;

      // Try to update record with null value
      const raw = await updateRecordRaw(
        table.id,
        recordId,
        {
          [requiredField.id]: null,
        },
        400
      );

      const parsed = updateRecordErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        // The error can be caught at domain layer (invalid_value) or database layer (not_null)
        expect(parsed.data.error.code).toMatch(/validation\.field\.(not_null|invalid_value)/);
        expect(parsed.data.error.tags).toContain('validation');
      }
    });
  });

  describe('unique constraint violations', () => {
    it('returns validation.field.unique error on insert with duplicate value', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('unique-insert'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const uniqueField = await createField(table.id, {
        type: 'singleLineText',
        name: 'UniqueCode',
        unique: true,
      });

      // Create first record
      await createRecordRaw(table.id, {
        [uniqueField.id]: 'CODE001',
      });

      // Try to create second record with same value
      const raw = await createRecordRaw(
        table.id,
        {
          [uniqueField.id]: 'CODE001',
        },
        400
      );

      const parsed = createRecordErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        expect(parsed.data.error.code).toBe('validation.field.unique');
        expect(parsed.data.error.tags).toContain('validation');
        expect(parsed.data.error.message).toContain('unique');
      }
    });

    it('returns validation.field.unique error on batch insert with duplicate value', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('unique-batch-insert'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const uniqueField = await createField(table.id, {
        type: 'singleLineText',
        name: 'UniqueCode',
        unique: true,
      });

      // Create first record
      await createRecordsRaw(table.id, [
        {
          fields: {
            [uniqueField.id]: 'BATCH001',
          },
        },
      ]);

      // Try to create second record with same value
      const raw = await createRecordsRaw(
        table.id,
        [
          {
            fields: {
              [uniqueField.id]: 'BATCH001',
            },
          },
        ],
        400
      );

      const parsed = createRecordsErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        expect(parsed.data.error.code).toBe('validation.field.unique');
        expect(parsed.data.error.tags).toContain('validation');
      }
    });

    it('returns validation.field.unique error on update with duplicate value', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('unique-update'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const uniqueField = await createField(table.id, {
        type: 'singleLineText',
        name: 'UniqueCode',
        unique: true,
      });

      // Create two records with different values
      await createRecordRaw(table.id, {
        [uniqueField.id]: 'UPD001',
      });
      const secondRecord = await createRecordRaw(table.id, {
        [uniqueField.id]: 'UPD002',
      });
      const secondRecordId = secondRecord.data.record.id;

      // Try to update second record with first record's value
      const raw = await updateRecordRaw(
        table.id,
        secondRecordId,
        {
          [uniqueField.id]: 'UPD001',
        },
        400
      );

      const parsed = updateRecordErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.ok).toBe(false);
        expect(parsed.data.error.code).toBe('validation.field.unique');
        expect(parsed.data.error.tags).toContain('validation');
      }
    });
  });

  describe('constraint error message format', () => {
    it('includes operation type in error message', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('error-message-format'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      await createField(table.id, {
        type: 'singleLineText',
        name: 'Required',
        notNull: true,
      });

      // Insert should include 'insert' in error message
      const insertRaw = await createRecordRaw(table.id, {}, 400);
      expect(insertRaw.error?.message).toContain('insert');
    });
  });
});
