/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRecordOkResponseSchema } from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { ActorId } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let globalFieldIdCounter = 0;
const createGlobalFieldId = () => {
  const suffix = globalFieldIdCounter.toString(36).padStart(16, '0');
  globalFieldIdCounter += 1;
  return `fld${suffix}`;
};

const makeCondition = (fieldId: string, value: string) => ({
  filter: {
    conjunction: 'and' as const,
    filterSet: [{ fieldId, operator: 'is', value }],
  },
});

describe('update-field: computed/system conversions (source + target)', () => {
  let ctx: SharedTestContext;
  let hostTableId: string;
  let hostPrimaryFieldId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let foreignNumberFieldId: string;

  const createTextField = async (name: string) => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'singleLineText', id: fieldId, name },
    });
    return fieldId;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Computed Conversion Foreign',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((f) => f.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
    const amountField = foreignTable.fields.find((f) => f.name === 'Amount');
    if (!amountField) throw new Error('No foreign amount field');
    foreignNumberFieldId = amountField.id;

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Computed Conversion Host',
      fields: [{ type: 'singleLineText', name: 'Host Name', isPrimary: true }],
    });
    hostTableId = hostTable.id;
    const primaryField = hostTable.fields.find((f) => f.isPrimary);
    if (!primaryField) throw new Error('No host primary field');
    hostPrimaryFieldId = primaryField.id;
  });

  afterAll(async () => {
    try {
      if (hostTableId) await ctx.deleteTable(hostTableId);
    } catch {
      // ignore cleanup failure
    }
    try {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    } catch {
      // ignore cleanup failure
    }
  });

  test('should convert singleLineText to createdTime', async () => {
    const fieldId = await createTextField('Text -> CreatedTime');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'createdTime' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('createdTime');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test.each([
    ['singleLineText', false],
    ['date', false],
    ['singleLineText', true],
    ['date', true],
  ] as const)(
    'preserves createdTime values when converting to %s (Y2853/Y2854, legacy=%s)',
    async (type, legacy) => {
      const fieldId = createGlobalFieldId();
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTableId,
        field: {
          type: 'createdTime',
          id: fieldId,
          name: 'CreatedTime Source',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Tokyo' },
          },
        },
      });
      const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });
      const before = (await ctx.listRecords(hostTableId)).find((row) => row.id === rec.id)!;
      const original = before.fields[fieldId];
      expect(typeof original).toBe('string');
      const field = table.fields.find((candidate) => candidate.id === fieldId)!;
      if (legacy) {
        const dbTable = sql.id(ctx.baseId, hostTableId);
        const column = sql.id(field.dbFieldName!);
        await sql`ALTER TABLE ${dbTable} DROP COLUMN ${column}`.execute(ctx.testContainer.db);
        await sql`ALTER TABLE ${dbTable} ADD COLUMN ${column} timestamp GENERATED ALWAYS AS (__created_time AT TIME ZONE 'UTC') STORED`.execute(
          ctx.testContainer.db
        );
      }
      const tokyo = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(String(original)));
      const converted = await ctx.updateField({ tableId: hostTableId, fieldId, field: { type } });
      expect(converted.fields.find((candidate) => candidate.id === fieldId)?.type).toBe(type);
      const after = (await ctx.listRecords(hostTableId)).find((row) => row.id === rec.id)!;
      expect(after.fields[fieldId]).toBe(type === 'date' ? original : tokyo);
      const stored = await sql<{
        value: string | Date;
      }>`SELECT ${sql.id(field.dbFieldName!)} AS value FROM ${sql.id(ctx.baseId, hostTableId)} WHERE __id = ${rec.id}`.execute(
        ctx.testContainer.db
      );
      const storedValue = stored.rows[0].value;
      expect(storedValue instanceof Date ? storedValue.toISOString() : storedValue).toBe(
        type === 'date' ? original : tokyo
      );
      const replacement = type === 'date' ? '2020-01-01T00:00:00.000Z' : 'Editable';
      await ctx.updateRecord(hostTableId, rec.id, { [fieldId]: replacement });
      const refreshed = (await ctx.listRecords(hostTableId)).find((row) => row.id === rec.id)!;
      expect(refreshed.fields[fieldId]).toBe(replacement);
      await ctx.deleteField({ tableId: hostTableId, fieldId });
      await ctx.deleteRecords(hostTableId, [rec.id]);
    }
  );

  test('should convert singleLineText to lastModifiedTime', async () => {
    const fieldId = await createTextField('Text -> LastModifiedTime');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'lastModifiedTime', options: { trackedFieldIds: [hostPrimaryFieldId] } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('lastModifiedTime');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert lastModifiedTime to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'lastModifiedTime',
        id: fieldId,
        name: 'LastModifiedTime Source',
        options: { trackedFieldIds: [hostPrimaryFieldId] },
      },
    });
    const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert singleLineText to createdBy', async () => {
    const fieldId = await createTextField('Text -> CreatedBy');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'createdBy' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('createdBy');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test.each([
    ['MMMM D, YYYY [at]', 'January 2, 2024 at 05:30'],
    ['MMM D, YYYY [Month]', 'Jan 2, 2024 Month 05:30'],
  ])('preserves createdTime display format %s', async (date, expected) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Formatted creation conversion',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'createdTime',
          name: 'Created',
          options: {
            formatting: { date, time: 'HH:mm', timeZone: 'Asia/Tokyo' },
          },
        },
      ],
    });
    try {
      const field = table.fields.find((candidate) => candidate.name === 'Created')!;
      const record = await ctx.createRecord(table.id, {});
      await sql`UPDATE ${sql.id(ctx.baseId, table.id)} SET __created_time = '2024-01-01T20:30:45.123Z' WHERE __id = ${record.id}`.execute(
        ctx.testContainer.db
      );
      const converted = await ctx.updateField({
        tableId: table.id,
        fieldId: field.id,
        field: { type: 'singleLineText' },
      });
      expect(converted.fields.find((candidate) => candidate.id === field.id)?.type).toBe(
        'singleLineText'
      );
      expect((await ctx.listRecords(table.id))[0].fields[field.id]).toBe(expected);
    } finally {
      await ctx.deleteTable(table.id);
    }
  });

  test('preserves historical creator snapshot display shapes', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Creator snapshot conversion',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'createdBy', name: 'Creator' },
      ],
    });
    try {
      const field = table.fields.find((candidate) => candidate.name === 'Creator')!;
      const shapes = [
        { value: { id: 'legacy-actor', name: 'Legacy, Author' }, expected: '"Legacy, Author"' },
        { value: { id: 'legacy-actor' }, expected: 'legacy-actor' },
        { value: 'legacy-actor', expected: 'legacy-actor' },
        { value: null, expected: ctx.testUser.name },
        { value: ctx.testUser.id, expected: ctx.testUser.name },
        { value: { id: ctx.testUser.id }, expected: ctx.testUser.name },
        { value: { id: ctx.testUser.id, title: 'Historical name' }, expected: ctx.testUser.name },
      ];
      const expected = new Map<string, string>();
      for (const shape of shapes) {
        const record = await ctx.createRecord(table.id, {});
        await sql`UPDATE ${sql.id(ctx.baseId, table.id)} SET ${sql.id(field.dbFieldName!)} = ${JSON.stringify(shape.value)}::jsonb WHERE __id = ${record.id}`.execute(
          ctx.testContainer.db
        );
        expected.set(record.id, shape.expected);
      }
      const converted = await ctx.updateField({
        tableId: table.id,
        fieldId: field.id,
        field: { type: 'singleLineText' },
      });
      expect(converted.fields.find((candidate) => candidate.id === field.id)?.type).toBe(
        'singleLineText'
      );
      for (const row of await ctx.listRecords(table.id)) {
        expect(row.fields[field.id]).toBe(expected.get(row.id));
      }
    } finally {
      await ctx.deleteTable(table.id);
    }
  });

  test.each(['snapshot', 'generated', 'stale-meta'] as const)(
    'preserves creator names and comma quoting (Y2870, storage=%s)',
    async (storage) => {
      const generated = storage !== 'snapshot';
      const fieldId = createGlobalFieldId();
      const table = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTableId,
        field: { type: 'createdBy', id: fieldId, name: 'CreatedBy Source' },
      });
      const field = table.fields.find((candidate) => candidate.id === fieldId)!;
      // Legacy tables store generated creator IDs; new tables store JSON snapshots.
      if (generated) {
        const dbTable = sql.id(ctx.baseId, hostTableId);
        const column = sql.id(field.dbFieldName!);
        await sql`ALTER TABLE ${dbTable} DROP COLUMN ${column}`.execute(ctx.testContainer.db);
        await sql`ALTER TABLE ${dbTable} ADD COLUMN ${column} text GENERATED ALWAYS AS (__created_by) STORED`.execute(
          ctx.testContainer.db
        );
        await ctx.testContainer.db
          .updateTable('field')
          .set({
            meta: JSON.stringify({ persistedAsGeneratedColumn: storage === 'generated' }),
            db_field_type: 'TEXT',
          })
          .where('id', '=', fieldId)
          .execute();
      }
      const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });
      const secondUser = {
        id: 'usrConversionActor',
        name: 'Example, Author',
        email: 'conversion@example.test',
      };
      await ctx.testContainer.db
        .insertInto('users')
        .values(secondUser)
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      await ctx.testContainer.db
        .insertInto('collaborator')
        .values({
          id: `col${secondUser.id}`,
          resource_type: 'base',
          resource_id: ctx.baseId,
          principal_id: secondUser.id,
          principal_type: 'user',
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute();
      const app = express();
      app.use(
        createV2ExpressRouter({
          createContainer: () => ctx.testContainer.container,
          createExecutionContext: () => ({
            actorId: ActorId.create(secondUser.id)._unsafeUnwrap(),
          }),
        })
      );
      const server = await new Promise<Server>((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      });
      try {
        const response = await fetch(
          `http://127.0.0.1:${(server.address() as AddressInfo).port}/tables/createRecord`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tableId: hostTableId, fields: { [hostPrimaryFieldId]: 'B' } }),
          }
        );
        expect(response.status).toBe(201);
        const parsed = createRecordOkResponseSchema.parse(await response.json());
        if (!parsed.ok) throw new Error('Second actor record creation failed');
        const second = parsed.data.record;
        const before = await ctx.listRecords(hostTableId);
        if (generated) {
          expect(before.find((row) => row.id === rec.id)?.fields[fieldId]).toBe(ctx.testUser.id);
          expect(before.find((row) => row.id === second.id)?.fields[fieldId]).toBe(secondUser.id);
        } else {
          expect(before.find((row) => row.id === rec.id)?.fields[fieldId]).toMatchObject({
            title: ctx.testUser.name,
          });
          expect(before.find((row) => row.id === second.id)?.fields[fieldId]).toMatchObject({
            title: secondUser.name,
          });
        }
        await ctx.updateField({ tableId: hostTableId, fieldId, field: { type: 'singleLineText' } });
        const after = await ctx.listRecords(hostTableId);
        expect(after.find((row) => row.id === rec.id)?.fields[fieldId]).toBe(ctx.testUser.name);
        expect(after.find((row) => row.id === second.id)?.fields[fieldId]).toBe(
          '"Example, Author"'
        );
        const stored = await sql<{
          value: string;
        }>`SELECT ${sql.id(field.dbFieldName!)} AS value FROM ${sql.id(ctx.baseId, hostTableId)} WHERE __id = ${second.id}`.execute(
          ctx.testContainer.db
        );
        expect(stored.rows[0].value).toBe('"Example, Author"');
        await ctx.updateRecord(hostTableId, second.id, { [hostPrimaryFieldId]: 'Refreshed' });
        const refreshed = await ctx.listRecords(hostTableId);
        expect(refreshed.find((row) => row.id === second.id)?.fields[fieldId]).toBe(
          '"Example, Author"'
        );
        await ctx.deleteRecords(hostTableId, [rec.id, second.id]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
        await ctx.deleteField({ tableId: hostTableId, fieldId });
      }
    }
  );

  test('should convert singleLineText to lastModifiedBy', async () => {
    const fieldId = await createTextField('Text -> LastModifiedBy');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'lastModifiedBy', options: { trackedFieldIds: [hostPrimaryFieldId] } },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('lastModifiedBy');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert lastModifiedBy to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'lastModifiedBy',
        id: fieldId,
        name: 'LastModifiedBy Source',
        options: { trackedFieldIds: [hostPrimaryFieldId] },
      },
    });
    const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert singleLineText to autoNumber', async () => {
    const fieldId = await createTextField('Text -> AutoNumber');
    const rec1 = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });
    const rec2 = await ctx.createRecord(hostTableId, {});

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'autoNumber' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField).toMatchObject({
      type: 'autoNumber',
      isComputed: true,
    });

    // Verify autoNumber values are sequentially assigned (integers, rec1 < rec2)
    const records = await ctx.listRecords(hostTableId);
    const rec1Data = records.find((r) => r.id === rec1.id);
    const rec2Data = records.find((r) => r.id === rec2.id);
    const val1 = rec1Data?.fields[fieldId] as number;
    const val2 = rec2Data?.fields[fieldId] as number;
    expect(Number.isInteger(val1)).toBe(true);
    expect(Number.isInteger(val2)).toBe(true);
    expect(val2).toEqual(val1 + 1);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec1.id, rec2.id]);
  });

  test('should convert autoNumber to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: { type: 'autoNumber', id: fieldId, name: 'AutoNumber Source' },
    });
    const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert singleLineText to conditionalLookup', async () => {
    const fieldId = await createTextField('Text -> ConditionalLookup');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'conditionalLookup',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { isLookup?: boolean; conditionalLookupOptions?: unknown }
      | undefined;
    expect(updatedField?.isLookup).toBe(true);
    expect(updatedField?.conditionalLookupOptions).toBeTruthy();

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert conditionalLookup to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalLookup',
        id: fieldId,
        name: 'ConditionalLookup Source',
        options: {
          foreignTableId,
          lookupFieldId: foreignPrimaryFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });
    const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId) as
      | { type?: string; isLookup?: boolean }
      | undefined;
    expect(updatedField?.type).toBe('singleLineText');
    expect(updatedField?.isLookup).not.toBe(true);

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert singleLineText to conditionalRollup', async () => {
    const fieldId = await createTextField('Text -> ConditionalRollup');
    const rec = await ctx.createRecord(hostTableId, { [fieldId]: 'x' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: {
        type: 'conditionalRollup',
        cellValueType: 'number',
        isMultipleCellValue: false,
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('conditionalRollup');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });

  test('should convert conditionalRollup to singleLineText', async () => {
    const fieldId = createGlobalFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: hostTableId,
      field: {
        type: 'conditionalRollup',
        id: fieldId,
        name: 'ConditionalRollup Source',
        options: {
          expression: 'sum({values})',
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: foreignNumberFieldId,
          condition: makeCondition(foreignPrimaryFieldId, 'Seed'),
        },
      },
    });
    const rec = await ctx.createRecord(hostTableId, { [hostPrimaryFieldId]: 'A' });

    const updatedTable = await ctx.updateField({
      tableId: hostTableId,
      fieldId,
      field: { type: 'singleLineText' },
    });

    const updatedField = updatedTable.fields.find((f) => f.id === fieldId);
    expect(updatedField?.type).toBe('singleLineText');

    await ctx.deleteField({ tableId: hostTableId, fieldId });
    await ctx.deleteRecords(hostTableId, [rec.id]);
  });
});
