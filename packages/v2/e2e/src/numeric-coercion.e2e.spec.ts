/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V2 Numeric Coercion E2E Tests
 *
 * These tests verify that v2 formula numeric coercion correctly extracts numeric prefixes
 * from text fields, matching v1 behavior. This is critical when FORCE_V2_ALL=true.
 *
 * Test cases ported from:
 * - community/apps/nestjs-backend/test/generated-column-numeric-coercion.e2e-spec.ts
 * - community/apps/nestjs-backend/test/select-formula-numeric-coercion.e2e-spec.ts
 */

import { createFieldOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const toUtcDateString = (date: Date) => {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date passed to toUtcDateString helper');
  }
  return date.toISOString().slice(0, 10);
};

const addUtcDays = (date: Date, days: number) => {
  const utcStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utcStart.setUTCDate(utcStart.getUTCDate() + days);
  return utcStart;
};

const shiftDateString = (value: unknown, days: number, fallback: Date) => {
  let base = typeof value === 'string' ? new Date(value) : undefined;
  if (!base || Number.isNaN(base.getTime())) {
    base = new Date(fallback);
  }
  const utcStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  utcStart.setUTCDate(utcStart.getUTCDate() + days);
  return toUtcDateString(utcStart);
};

describe('v2 numeric coercion (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  describe('text fields in arithmetic formulas', () => {
    it('coerces numeric strings with suffixes when updating generated columns', async () => {
      // Create table with text fields and formula fields
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'numeric_coercion_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Planned Duration' },
          { type: 'singleLineText', name: 'Consumed Days' },
        ],
        views: [{ type: 'grid' }],
      });

      const durationFieldId =
        (table.fields.find((f: any) => f.name === 'Planned Duration') as any)?.id ?? '';
      const consumedFieldId =
        (table.fields.find((f: any) => f.name === 'Consumed Days') as any)?.id ?? '';

      // Add formula fields using fetch API directly
      const createRemainingFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Remaining Days',
            options: {
              expression: `{${durationFieldId}} - {${consumedFieldId}}`,
            },
          },
        }),
      });

      const remainingFieldRaw = await createRemainingFieldResponse.json();
      const remainingFieldParsed = createFieldOkResponseSchema.safeParse(remainingFieldRaw);
      expect(remainingFieldParsed.success).toBe(true);
      if (!remainingFieldParsed.success || !remainingFieldParsed.data.ok) return;

      const tableWithRemaining = remainingFieldParsed.data.data.table;
      const remainingFieldId =
        tableWithRemaining.fields.find((f: any) => f.name === 'Remaining Days')?.id ?? '';

      const createProgressFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Progress',
            options: {
              expression: `{${consumedFieldId}} / {${durationFieldId}}`,
            },
          },
        }),
      });

      const progressFieldRaw = await createProgressFieldResponse.json();
      const progressFieldParsed = createFieldOkResponseSchema.safeParse(progressFieldRaw);
      expect(progressFieldParsed.success).toBe(true);
      if (!progressFieldParsed.success || !progressFieldParsed.data.ok) return;

      const tableWithProgress = progressFieldParsed.data.data.table;
      const progressFieldId =
        tableWithProgress.fields.find((f: any) => f.name === 'Progress')?.id ?? '';

      // Create record with "10天" and "3"
      const record = await ctx.createRecord(table.id, {
        Name: 'Test',
        [durationFieldId]: '10天',
        [consumedFieldId]: '3',
      });

      await ctx.drainOutbox();
      let records = await ctx.listRecords(table.id);

      // Should extract: 10 - 3 = 7
      expect(records[0].fields[remainingFieldId]).toBe(7);
      expect(records[0].fields[progressFieldId]).toBeCloseTo(3 / 10, 2);

      // Update with "4天"
      await ctx.updateRecord(table.id, record.id, { [consumedFieldId]: '4天' });
      await ctx.drainOutbox();
      records = await ctx.listRecords(table.id);

      // Should extract: 10 - 4 = 6
      expect(records[0].fields[remainingFieldId]).toBe(6);
      expect(records[0].fields[progressFieldId]).toBeCloseTo(4 / 10, 2);

      // Update with "12周"
      await ctx.updateRecord(table.id, record.id, { [durationFieldId]: '12周' });
      await ctx.drainOutbox();
      records = await ctx.listRecords(table.id);

      // Should extract: 12 - 4 = 8
      expect(records[0].fields[remainingFieldId]).toBe(8);
      expect(records[0].fields[progressFieldId]).toBeCloseTo(4 / 12, 2);
    });
  });

  describe('blank arithmetic operands', () => {
    it('treats blank operands as zero in arithmetic formulas', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'blank_arithmetic_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Value' },
          { type: 'number', name: 'Optional' },
        ],
        views: [{ type: 'grid' }],
      });

      const valueFieldId = (table.fields.find((f: any) => f.name === 'Value') as any)?.id ?? '';
      const optionalFieldId =
        (table.fields.find((f: any) => f.name === 'Optional') as any)?.id ?? '';

      // Add formula fields using fetch API directly
      const createAddFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Add',
            options: { expression: `{${valueFieldId}} + {${optionalFieldId}}` },
          },
        }),
      });
      const addFieldRaw = await createAddFieldResponse.json();
      const addFieldParsed = createFieldOkResponseSchema.safeParse(addFieldRaw);
      expect(addFieldParsed.success).toBe(true);
      if (!addFieldParsed.success || !addFieldParsed.data.ok) return;
      let updatedTable = addFieldParsed.data.data.table;

      const createSubtractFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Subtract',
            options: { expression: `{${valueFieldId}} - {${optionalFieldId}}` },
          },
        }),
      });
      const subtractFieldRaw = await createSubtractFieldResponse.json();
      const subtractFieldParsed = createFieldOkResponseSchema.safeParse(subtractFieldRaw);
      expect(subtractFieldParsed.success).toBe(true);
      if (!subtractFieldParsed.success || !subtractFieldParsed.data.ok) return;
      updatedTable = subtractFieldParsed.data.data.table;

      const createMultiplyFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Multiply',
            options: { expression: `{${valueFieldId}} * {${optionalFieldId}}` },
          },
        }),
      });
      const multiplyFieldRaw = await createMultiplyFieldResponse.json();
      const multiplyFieldParsed = createFieldOkResponseSchema.safeParse(multiplyFieldRaw);
      expect(multiplyFieldParsed.success).toBe(true);
      if (!multiplyFieldParsed.success || !multiplyFieldParsed.data.ok) return;
      updatedTable = multiplyFieldParsed.data.data.table;

      const createDivValueByOptFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Value / Optional',
            options: { expression: `{${valueFieldId}} / {${optionalFieldId}}` },
          },
        }),
      });
      const divValueByOptFieldRaw = await createDivValueByOptFieldResponse.json();
      const divValueByOptFieldParsed = createFieldOkResponseSchema.safeParse(divValueByOptFieldRaw);
      expect(divValueByOptFieldParsed.success).toBe(true);
      if (!divValueByOptFieldParsed.success || !divValueByOptFieldParsed.data.ok) return;
      updatedTable = divValueByOptFieldParsed.data.data.table;

      const createDivOptByValueFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Optional / Value',
            options: { expression: `{${optionalFieldId}} / {${valueFieldId}}` },
          },
        }),
      });
      const divOptByValueFieldRaw = await createDivOptByValueFieldResponse.json();
      const divOptByValueFieldParsed = createFieldOkResponseSchema.safeParse(divOptByValueFieldRaw);
      expect(divOptByValueFieldParsed.success).toBe(true);
      if (!divOptByValueFieldParsed.success || !divOptByValueFieldParsed.data.ok) return;
      updatedTable = divOptByValueFieldParsed.data.data.table;

      const addFieldId = updatedTable.fields.find((f: any) => f.name === 'Add')?.id ?? '';
      const subtractFieldId = updatedTable.fields.find((f: any) => f.name === 'Subtract')?.id ?? '';
      const multiplyFieldId = updatedTable.fields.find((f: any) => f.name === 'Multiply')?.id ?? '';
      const divValueByOptFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Value / Optional')?.id ?? '';
      const divOptByValueFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Optional / Value')?.id ?? '';

      // Create records: one with Value only, one with Optional only
      const valueOnlyRecord = await ctx.createRecord(table.id, {
        Name: 'Value Only',
        [valueFieldId]: 10,
      });

      const optionalOnlyRecord = await ctx.createRecord(table.id, {
        Name: 'Optional Only',
        [optionalFieldId]: 4,
      });

      await ctx.drainOutbox();
      const records = await ctx.listRecords(table.id);

      const recordWithValue = records.find((r) => r.id === valueOnlyRecord.id);
      const recordWithOptional = records.find((r) => r.id === optionalOnlyRecord.id);

      if (!recordWithValue || !recordWithOptional) throw new Error('Records not found');

      // Record with Value=10, Optional=null
      // v1 behavior: blank numeric operands are treated as zero in arithmetic
      expect(recordWithValue.fields[addFieldId]).toBe(10);
      expect(recordWithValue.fields[subtractFieldId]).toBe(10);
      expect(recordWithValue.fields[multiplyFieldId]).toBe(0);
      expect(recordWithValue.fields[divOptByValueFieldId]).toBe(0);
      expect(recordWithValue.fields[divValueByOptFieldId] ?? null).toBeNull();

      // Record with Value=null, Optional=4
      // v1 behavior: blank numeric operands are treated as zero in arithmetic
      expect(recordWithOptional.fields[addFieldId]).toBe(4);
      expect(recordWithOptional.fields[subtractFieldId]).toBe(-4);
      expect(recordWithOptional.fields[multiplyFieldId]).toBe(0);
      expect(recordWithOptional.fields[divValueByOptFieldId]).toBe(0);
      expect(recordWithOptional.fields[divOptByValueFieldId] ?? null).toBeNull();
    });
  });

  describe('date arithmetic with generated formulas', () => {
    it('supports date minus numeric operands and comparisons with TODAY()', async () => {
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      const dueDateUtc = addUtcDays(todayUtc, 5);
      // v2 date fields expect ISO datetime strings (with time component)
      const dueDateValue = dueDateUtc.toISOString();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'date_arithmetic_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'date', name: 'Due Date' },
          { type: 'number', name: 'Buffer Days' },
        ],
        views: [{ type: 'grid' }],
      });

      const dueDateFieldId =
        (table.fields.find((f: any) => f.name === 'Due Date') as any)?.id ?? '';
      const bufferDaysFieldId =
        (table.fields.find((f: any) => f.name === 'Buffer Days') as any)?.id ?? '';

      const createStartDateFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Start Date',
            options: {
              expression: `DATESTR({${dueDateFieldId}} - {${bufferDaysFieldId}})`,
            },
          },
        }),
      });
      const startDateFieldRaw = await createStartDateFieldResponse.json();
      const startDateFieldParsed = createFieldOkResponseSchema.safeParse(startDateFieldRaw);
      expect(startDateFieldParsed.success).toBe(true);
      if (!startDateFieldParsed.success || !startDateFieldParsed.data.ok) return;
      let updatedTable = startDateFieldParsed.data.data.table;

      const createStatusFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status',
            options: {
              expression: `IF({${dueDateFieldId}} - {${bufferDaysFieldId}} <= TODAY(),"ready","pending")`,
            },
          },
        }),
      });
      const statusFieldRaw = await createStatusFieldResponse.json();
      const statusFieldParsed = createFieldOkResponseSchema.safeParse(statusFieldRaw);
      expect(statusFieldParsed.success).toBe(true);
      if (!statusFieldParsed.success || !statusFieldParsed.data.ok) return;
      updatedTable = statusFieldParsed.data.data.table;

      const startDateFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Start Date')?.id ?? '';
      const statusFieldId = updatedTable.fields.find((f: any) => f.name === 'Status')?.id ?? '';

      // Create record
      const record = await ctx.createRecord(table.id, {
        Name: 'Test',
        [dueDateFieldId]: dueDateValue,
        [bufferDaysFieldId]: 2,
      });

      await ctx.drainOutbox();
      let records = await ctx.listRecords(table.id);

      const storedDueDate = records[0].fields[dueDateFieldId] as string | undefined;
      const expectedInitialLead = shiftDateString(storedDueDate, -2, dueDateUtc);
      expect(records[0].fields[startDateFieldId]).toBe(expectedInitialLead);
      expect(records[0].fields[statusFieldId]).toBe('pending');

      // Update buffer to 7
      await ctx.updateRecord(table.id, record.id, { [bufferDaysFieldId]: 7 });
      await ctx.drainOutbox();
      records = await ctx.listRecords(table.id);

      const updatedDueDate = records[0].fields[dueDateFieldId] as string | undefined;
      const expectedUpdatedLead = shiftDateString(updatedDueDate, -7, dueDateUtc);
      expect(records[0].fields[startDateFieldId]).toBe(expectedUpdatedLead);
      expect(records[0].fields[statusFieldId]).toBe('ready');
    });
  });

  describe('workday diff with numeric inputs', () => {
    it('returns null instead of raising a cast error', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'workday_numeric_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Month Number' },
        ],
        views: [{ type: 'grid' }],
      });

      const monthFieldId =
        (table.fields.find((f: any) => f.name === 'Month Number') as any)?.id ?? '';

      const createWorkdayDiffFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Workdays Delta',
            options: {
              expression: `WORKDAY_DIFF({${monthFieldId}} + 1, {${monthFieldId}})`,
              timeZone: 'Etc/GMT-8',
            },
          },
        }),
      });
      const workdayDiffFieldRaw = await createWorkdayDiffFieldResponse.json();
      const workdayDiffFieldParsed = createFieldOkResponseSchema.safeParse(workdayDiffFieldRaw);
      if (!workdayDiffFieldParsed.success) {
        console.error(
          'WORKDAY_DIFF field creation failed:',
          JSON.stringify(workdayDiffFieldRaw, null, 2)
        );
        console.error('Zod validation errors:', workdayDiffFieldParsed.error);
      }
      expect(workdayDiffFieldParsed.success).toBe(true);
      if (!workdayDiffFieldParsed.success || !workdayDiffFieldParsed.data.ok) return;
      const updatedTable = workdayDiffFieldParsed.data.data.table;

      const workdayDiffFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Workdays Delta')?.id ?? '';

      // Create record
      const record = await ctx.createRecord(table.id, {
        Name: 'Test',
        [monthFieldId]: 8,
      });

      await ctx.drainOutbox();
      let records = await ctx.listRecords(table.id);

      expect(records[0].fields[workdayDiffFieldId] ?? null).toBeNull();

      // Update to 12
      await ctx.updateRecord(table.id, record.id, { [monthFieldId]: 12 });
      await ctx.drainOutbox();
      records = await ctx.listRecords(table.id);

      expect(records[0].fields[workdayDiffFieldId] ?? null).toBeNull();
    });
  });

  describe('workday with date and numeric field inputs (regression)', () => {
    it('creates field and computes date when days parameter references number field', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'workday_date_number_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'date', name: 'Date' },
          { type: 'number', name: 'Number' },
        ],
        views: [{ type: 'grid' }],
      });

      const dateFieldId = (table.fields.find((f: any) => f.name === 'Date') as any)?.id ?? '';
      const numberFieldId = (table.fields.find((f: any) => f.name === 'Number') as any)?.id ?? '';

      const createWorkdayFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Workday Date',
            options: {
              expression: `DATESTR(WORKDAY({${dateFieldId}}, {${numberFieldId}}))`,
              timeZone: 'Asia/Shanghai',
            },
          },
        }),
      });
      const workdayFieldRaw = await createWorkdayFieldResponse.json();
      const workdayFieldParsed = createFieldOkResponseSchema.safeParse(workdayFieldRaw);
      if (!workdayFieldParsed.success) {
        console.error('WORKDAY field creation failed:', JSON.stringify(workdayFieldRaw, null, 2));
        console.error('Zod validation errors:', workdayFieldParsed.error);
      }
      expect(workdayFieldParsed.success).toBe(true);
      if (!workdayFieldParsed.success || !workdayFieldParsed.data.ok) return;
      const updatedTable = workdayFieldParsed.data.data.table;

      const workdayFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Workday Date')?.id ?? '';

      const record = await ctx.createRecord(table.id, {
        Name: 'Test',
        [dateFieldId]: '2026-01-22',
        [numberFieldId]: 1,
      });

      await ctx.drainOutbox();
      let records = await ctx.listRecords(table.id);
      expect(records[0].fields[workdayFieldId]).toBe('2026-01-23');

      await ctx.updateRecord(table.id, record.id, { [numberFieldId]: 3 });
      await ctx.drainOutbox();
      records = await ctx.listRecords(table.id);
      expect(records[0].fields[workdayFieldId]).toBe('2026-01-25');
    });
  });

  describe('workday diff referencing numeric formula (regression)', () => {
    it('returns null when numeric formula is used as date input', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'workday_formula_ref_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Dummy' },
        ],
        views: [{ type: 'grid' }],
      });

      const createMonthNumFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Month Num',
            options: {
              expression: 'MONTH(TODAY())-1',
              timeZone: 'Etc/GMT-8',
            },
          },
        }),
      });
      const monthNumFieldRaw = await createMonthNumFieldResponse.json();
      const monthNumFieldParsed = createFieldOkResponseSchema.safeParse(monthNumFieldRaw);
      expect(monthNumFieldParsed.success).toBe(true);
      if (!monthNumFieldParsed.success || !monthNumFieldParsed.data.ok) return;
      let updatedTable = monthNumFieldParsed.data.data.table;

      const monthFormulaFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Month Num')?.id ?? '';

      const createMonthWorkdaysFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Month Workdays',
            options: {
              expression: `WORKDAY_DIFF({${monthFormulaFieldId}} + 1, {${monthFormulaFieldId}})`,
              timeZone: 'Etc/GMT-8',
            },
          },
        }),
      });
      const monthWorkdaysFieldRaw = await createMonthWorkdaysFieldResponse.json();
      const monthWorkdaysFieldParsed = createFieldOkResponseSchema.safeParse(monthWorkdaysFieldRaw);
      if (!monthWorkdaysFieldParsed.success) {
        console.error(
          'Month Workdays field creation failed:',
          JSON.stringify(monthWorkdaysFieldRaw, null, 2)
        );
        console.error('Zod validation errors:', monthWorkdaysFieldParsed.error);
      }
      expect(monthWorkdaysFieldParsed.success).toBe(true);
      if (!monthWorkdaysFieldParsed.success || !monthWorkdaysFieldParsed.data.ok) return;
      updatedTable = monthWorkdaysFieldParsed.data.data.table;

      const workdayDiffFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Month Workdays')?.id ?? '';

      // Create record
      await ctx.createRecord(table.id, {
        Name: 'Test',
        Dummy: 1,
      });

      await ctx.drainOutbox();
      const records = await ctx.listRecords(table.id);

      expect(records[0].fields[workdayDiffFieldId] ?? null).toBeNull();
    });
  });

  describe('checkbox values in formulas', () => {
    it('compares checkbox values against numeric literals', async () => {
      // Regression test: checkbox true should equal 1, false should equal 0
      // Formula: IF({checkbox} = 1, 'already', 'pending')
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'checkbox_numeric_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'checkbox', name: 'Notified' },
        ],
        views: [{ type: 'grid' }],
      });

      const checkboxFieldId =
        (table.fields.find((f: any) => f.name === 'Notified') as any)?.id ?? '';

      // Create formula: IF({checkbox} = 1, 'already', 'pending')
      const createFormulaFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Notify Status',
            options: {
              expression: `IF({${checkboxFieldId}} = 1, 'already', 'pending')`,
            },
          },
        }),
      });

      const formulaFieldRaw = await createFormulaFieldResponse.json();
      const formulaFieldParsed = createFieldOkResponseSchema.safeParse(formulaFieldRaw);
      expect(formulaFieldParsed.success).toBe(true);
      if (!formulaFieldParsed.success || !formulaFieldParsed.data.ok) return;

      const updatedTable = formulaFieldParsed.data.data.table;
      const formulaFieldId =
        updatedTable.fields.find((f: any) => f.name === 'Notify Status')?.id ?? '';

      // Create record with checkbox = true
      const notifiedRecord = await ctx.createRecord(table.id, {
        Name: 'Notified User',
        [checkboxFieldId]: true,
      });

      // Create record with checkbox = false (or null, which is treated as false)
      const pendingRecord = await ctx.createRecord(table.id, {
        Name: 'Pending User',
        [checkboxFieldId]: false,
      });

      await ctx.drainOutbox();
      const records = await ctx.listRecords(table.id);

      const notifiedResult = records.find((r) => r.id === notifiedRecord.id);
      const pendingResult = records.find((r) => r.id === pendingRecord.id);

      // checkbox true should compare equal to 1, returning 'already'
      expect(notifiedResult?.fields[formulaFieldId]).toBe('already');

      // checkbox false should NOT compare equal to 1, returning 'pending'
      expect(pendingResult?.fields[formulaFieldId]).toBe('pending');
    });

    it('compares checkbox values against zero', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'checkbox_zero_test',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'checkbox', name: 'Active' },
        ],
        views: [{ type: 'grid' }],
      });

      const checkboxFieldId = (table.fields.find((f: any) => f.name === 'Active') as any)?.id ?? '';

      // Create formula: IF({checkbox} = 0, 'inactive', 'active')
      const createFormulaFieldResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            name: 'Status',
            options: {
              expression: `IF({${checkboxFieldId}} = 0, 'inactive', 'active')`,
            },
          },
        }),
      });

      const formulaFieldRaw = await createFormulaFieldResponse.json();
      const formulaFieldParsed = createFieldOkResponseSchema.safeParse(formulaFieldRaw);
      expect(formulaFieldParsed.success).toBe(true);
      if (!formulaFieldParsed.success || !formulaFieldParsed.data.ok) return;

      const updatedTable = formulaFieldParsed.data.data.table;
      const formulaFieldId = updatedTable.fields.find((f: any) => f.name === 'Status')?.id ?? '';

      // Create record with checkbox = true
      const activeRecord = await ctx.createRecord(table.id, {
        Name: 'Active User',
        [checkboxFieldId]: true,
      });

      // Create record with checkbox = false
      const inactiveRecord = await ctx.createRecord(table.id, {
        Name: 'Inactive User',
        [checkboxFieldId]: false,
      });

      await ctx.drainOutbox();
      const records = await ctx.listRecords(table.id);

      const activeResult = records.find((r) => r.id === activeRecord.id);
      const inactiveResult = records.find((r) => r.id === inactiveRecord.id);

      // checkbox true (=1) should NOT compare equal to 0, returning 'active'
      expect(activeResult?.fields[formulaFieldId]).toBe('active');

      // checkbox false (=0) should compare equal to 0, returning 'inactive'
      expect(inactiveResult?.fields[formulaFieldId]).toBe('inactive');
    });
  });
});
