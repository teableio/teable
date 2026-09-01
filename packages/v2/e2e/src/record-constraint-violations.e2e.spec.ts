/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordErrorResponseSchema,
  createRecordsErrorResponseSchema,
  updateRecordErrorResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
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
        expect(parsed.data.error.message).toMatch(/cannot be empty|not-null/);
        expect(parsed.data.error.localization).toEqual({
          i18nKey: 'httpErrors.custom.recordFieldValueNotNull',
          context: { fieldName: 'Required' },
        });
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
        expect(parsed.data.error.message).toMatch(/unique/);
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

    it('returns field identity when a v1-named unique index is violated on createRecords', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('unique-v1-index'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const uniqueField = await createField(table.id, {
        type: 'singleLineText',
        name: 'Email',
        unique: true,
      });

      const tableMeta = await ctx.testContainer.metaDb
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', table.id)
        .executeTakeFirst();
      const dbTableName = tableMeta?.db_table_name;
      if (!dbTableName) {
        throw new Error('Missing physical table name');
      }
      const [schemaName, physicalTableName] = dbTableName.split('.');
      if (!schemaName || !physicalTableName) {
        throw new Error(`Unexpected physical table name: ${dbTableName}`);
      }

      const fieldMeta = await ctx.testContainer.metaDb
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', uniqueField.id)
        .executeTakeFirst();
      const dbFieldName = fieldMeta?.db_field_name;
      if (!dbFieldName) {
        throw new Error('Missing unique field column name');
      }

      const v2IndexName = `${physicalTableName}_${dbFieldName}_unique`;
      const v1Suffix = `___${uniqueField.id}_unique`;
      const v1IndexName = `${`${schemaName}_${physicalTableName}`.slice(
        0,
        63 - v1Suffix.length
      )}${v1Suffix}`.toLowerCase();

      await sql
        .raw(
          `ALTER TABLE "${schemaName}"."${physicalTableName}" DROP CONSTRAINT IF EXISTS "${v2IndexName}"`
        )
        .execute(ctx.testContainer.db);
      await sql
        .raw(`DROP INDEX IF EXISTS "${schemaName}"."${v2IndexName}"`)
        .execute(ctx.testContainer.db);
      await sql
        .raw(
          `CREATE UNIQUE INDEX "${v1IndexName}" ON "${schemaName}"."${physicalTableName}" ("${dbFieldName}")`
        )
        .execute(ctx.testContainer.db);

      await createRecordsRaw(table.id, [
        {
          fields: {
            [uniqueField.id]: 'dup@example.com',
          },
        },
      ]);

      const raw = await createRecordsRaw(
        table.id,
        [
          {
            fields: {
              [uniqueField.id]: 'dup@example.com',
            },
          },
        ],
        400
      );

      const parsed = createRecordsErrorResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.ok).toBe(false);
      expect(parsed.data.error.code).toBe('validation.field.unique');
      expect(parsed.data.error.message).toContain(uniqueField.id);
      expect(parsed.data.error.details).toEqual({
        fieldId: uniqueField.id,
        fieldName: 'Email',
      });
      expect(parsed.data.error.localization).toEqual({
        i18nKey: 'httpErrors.custom.recordFieldValueDuplicate',
        context: { fieldName: 'Email' },
      });
    });
  });

  describe('constraint error message format', () => {
    it('names the violated field in the create error message', async () => {
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

      // A missing notNull field is rejected by application-level pre-validation
      // before any SQL runs (T6520 auto-number continuity), so the message names
      // the field instead of the SQL operation.
      const insertRaw = await createRecordRaw(table.id, {}, 400);
      expect(insertRaw.error?.code).toBe('validation.field.not_null');
      expect(insertRaw.error?.message).toContain('Required');
    });
  });
});
