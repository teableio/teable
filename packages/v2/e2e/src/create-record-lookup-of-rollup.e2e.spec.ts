/* eslint-disable @typescript-eslint/naming-convention */
/**
 * T6911: creating a record must not fail with Invalid RollupExpression when a
 * related lookup-of-rollup was rematerialized to type=rollup without a rollup
 * expression (v1 storage: type=rollup + is_lookup).
 *
 * Sanitized structure-equivalent of the CN salary-adjustment / employee /
 * payroll graph:
 * - Adjustment manyOne -> Employee
 * - Employee rollup max() over Adjustment numbers
 * - Payroll lookup of that Employee rollup
 */
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 create record with lookup-of-rollup (T6911)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('creates an adjustment record after a lookup-of-rollup loses its expression', async () => {
    const employeeNameFieldId = createFieldId();
    const employeeTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T6911 Employees',
      fields: [{ type: 'singleLineText', id: employeeNameFieldId, name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const employee = await ctx.createRecord(employeeTable.id, {
      [employeeNameFieldId]: 'Ada',
    });

    const basePayFieldId = createFieldId();
    const adjustmentLinkFieldId = createFieldId();
    const adjustmentTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T6911 Adjustments',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', id: basePayFieldId, name: 'Base Pay' },
        {
          type: 'link',
          id: adjustmentLinkFieldId,
          name: 'Employee',
          options: {
            relationship: 'manyOne',
            foreignTableId: employeeTable.id,
            lookupFieldId: employeeNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const employeeAfterLink = await ctx.getTableById(employeeTable.id);
    const employeeLinkFieldId =
      employeeAfterLink.fields.find((field) => field.type === 'link')?.id ?? '';
    expect(employeeLinkFieldId).toMatch(/^fld/);
    const overtimeRollup = await ctx.createField({
      baseId: ctx.baseId,
      tableId: employeeTable.id,
      field: {
        type: 'rollup',
        name: 'Overtime Rate',
        options: { expression: 'max({values})' },
        config: {
          linkFieldId: employeeLinkFieldId,
          foreignTableId: adjustmentTable.id,
          lookupFieldId: basePayFieldId,
        },
      },
    });
    const overtimeRollupId =
      overtimeRollup.fields.find((field) => field.name === 'Overtime Rate')?.id ?? '';
    expect(overtimeRollupId).toMatch(/^fld/);

    const payrollLinkFieldId = createFieldId();
    const payrollTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T6911 Payroll',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: payrollLinkFieldId,
          name: 'Employee',
          options: {
            relationship: 'manyOne',
            foreignTableId: employeeTable.id,
            lookupFieldId: employeeNameFieldId,
          },
        },
        {
          type: 'lookup',
          name: 'Payroll Overtime Rate',
          options: {
            linkFieldId: payrollLinkFieldId,
            foreignTableId: employeeTable.id,
            lookupFieldId: overtimeRollupId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const payrollLookupId =
      payrollTable.fields.find((field) => field.name === 'Payroll Overtime Rate')?.id ?? '';
    expect(payrollLookupId).toMatch(/^fld/);

    await sql`
      UPDATE field
      SET
        type = 'rollup',
        is_lookup = true,
        options = '{"formatting":{"type":"decimal","precision":0}}'::jsonb
      WHERE id = ${payrollLookupId}
    `.execute(ctx.testContainer.db);

    const created = await ctx.createRecord(adjustmentTable.id, {
      Title: '2024-01 raise',
      [basePayFieldId]: 4900,
      [adjustmentLinkFieldId]: { id: employee.id },
    });

    expect(created.id).toMatch(/^rec/);
    expect(created.fields[basePayFieldId]).toBe(4900);

    await ctx.testContainer.processOutbox();
    const payrollRows = await ctx.listRecords(payrollTable.id);
    expect(Array.isArray(payrollRows)).toBe(true);
  });
});
