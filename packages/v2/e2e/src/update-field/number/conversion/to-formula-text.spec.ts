/**
 * T6959: converting a double-precision number/autoNumber column to a
 * text formula must alter the physical column before backfill.
 *
 * Production shape (sanitized): a primary numeric id column was converted
 * to CONCATENATE("C-", RIGHT(CONCATENATE("000", AUTO_NUMBER() - 1), 3)).
 * Schema ops then failed with:
 * - column is of type double precision but expression is of type text
 * - operator does not exist: double precision ~ unknown
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { sql } from 'kysely';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';

const PADDED_CASE_ID_FORMULA = 'CONCATENATE("C-", RIGHT(CONCATENATE("000", AUTO_NUMBER() - 1), 3))';
const POSTGRES_SETUP_TIMEOUT_MS = 120_000;

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;

describe('update-field: number/autoNumber → text formula (T6959)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);
  }, POSTGRES_SETUP_TIMEOUT_MS);

  test('converts a number primary field to a padded text formula', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 't6959-number-primary-to-text-formula',
      fields: [{ type: 'number', name: 'Case ID', isPrimary: true }],
    });

    try {
      const caseIdField = table.fields.find((field) => field.isPrimary);
      if (!caseIdField) throw new Error('Primary field not found');

      await ctx.createRecords(table.id, [
        { fields: { [caseIdField.id]: 1 } },
        { fields: { [caseIdField.id]: 2 } },
        { fields: { [caseIdField.id]: 3 } },
      ]);
      await ctx.drainOutbox();

      const updated = await ctx.updateField({
        tableId: table.id,
        fieldId: caseIdField.id,
        field: {
          type: 'formula',
          options: { expression: PADDED_CASE_ID_FORMULA },
        },
      });
      await ctx.drainOutbox();

      const formulaField = updated.fields.find((field) => field.id === caseIdField.id);
      expect(formulaField?.type).toBe('formula');
      expect((formulaField as { cellValueType?: string } | undefined)?.cellValueType).toBe(
        'string'
      );

      const records = await ctx.listRecords(table.id);
      const values = records.map((record) => record.fields[caseIdField.id]).sort();
      expect(values).toEqual(['C-000', 'C-001', 'C-002']);
    } finally {
      await ctx.deleteTable(table.id).catch(() => undefined);
    }
  });

  test('changes a number formula expression to a padded text formula', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 't6959-number-formula-to-text-formula',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });

    try {
      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'formula',
          name: 'Case ID',
          options: { expression: 'AUTO_NUMBER() - 1' },
        },
      });
      const formulaField = withFormula.fields.find((field) => field.name === 'Case ID');
      if (!formulaField) throw new Error('Formula field not found');

      await ctx.createRecords(table.id, [
        { fields: { [table.fields[0]!.id]: 'r1' } },
        { fields: { [table.fields[0]!.id]: 'r2' } },
      ]);
      await ctx.drainOutbox();

      const updated = await ctx.updateField({
        tableId: table.id,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: { expression: PADDED_CASE_ID_FORMULA },
        },
      });
      await ctx.drainOutbox();

      expect(
        (
          updated.fields.find((field) => field.id === formulaField.id) as
            | { cellValueType?: string }
            | undefined
        )?.cellValueType
      ).toBe('string');

      const records = await ctx.listRecords(table.id);
      const values = records.map((record) => record.fields[formulaField.id]).sort();
      expect(values).toEqual(['C-000', 'C-001']);
    } finally {
      await ctx.deleteTable(table.id).catch(() => undefined);
    }
  });

  test('backfills a text formula after the physical column is left as double precision', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 't6959-stale-double-text-formula',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });

    try {
      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'formula',
          name: 'Case ID',
          options: { expression: PADDED_CASE_ID_FORMULA },
        },
      });
      const formulaField = withFormula.fields.find((field) => field.name === 'Case ID');
      if (!formulaField) throw new Error('Formula field not found');

      await ctx.createRecords(table.id, [
        { fields: { [table.fields[0]!.id]: 'r1' } },
        { fields: { [table.fields[0]!.id]: 'r2' } },
      ]);
      await ctx.drainOutbox();

      const fieldRow = await ctx.testContainer.db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', formulaField.id)
        .executeTakeFirstOrThrow();
      const tableMeta = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', table.id)
        .executeTakeFirstOrThrow();
      const [schemaName = 'public', tableName = tableMeta.db_table_name] =
        tableMeta.db_table_name.includes('.')
          ? tableMeta.db_table_name.split('.', 2)
          : ['public', tableMeta.db_table_name];

      await sql
        .raw(
          `ALTER TABLE ${quoteIdent(schemaName)}.${quoteIdent(tableName)} ALTER COLUMN ${quoteIdent(fieldRow.db_field_name)} TYPE double precision USING NULL`
        )
        .execute(ctx.testContainer.db);

      await ctx.updateField({
        tableId: table.id,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: { expression: 'CONCATENATE("C-", RIGHT(CONCATENATE("000", AUTO_NUMBER()), 3))' },
        },
      });
      await ctx.drainOutbox();

      const records = await ctx.listRecords(table.id);
      const values = records.map((record) => record.fields[formulaField.id]).sort();
      expect(values).toEqual(['C-001', 'C-002']);
    } finally {
      await ctx.deleteTable(table.id).catch(() => undefined);
    }
  });
});
