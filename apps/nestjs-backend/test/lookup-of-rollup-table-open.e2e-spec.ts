/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { Colors, FieldKeyType, FieldType, NumberFormattingType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  createView,
  getFields,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

/**
 * T6912 — sanitized, structure-equivalent reproduction of a CN payroll table
 * that cannot be opened.
 *
 * Retained structural facts:
 * - rate-history table (manyOne/oneMany) feeds an employee rollup (`max({values})`)
 * - payroll table looks up that rollup (`type=rollup`, `isLookup=true`)
 * - payroll also looks up a singleSelect and filters a view with `isAnyOf`
 * - opening the payroll view is GET /record with that viewId
 */
describe('Lookup of rollup table open (e2e) T6912', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  let employeeTable: ITableFullVo;
  let rateHistoryTable: ITableFullVo;
  let payrollTable: ITableFullVo;
  let employeeLinkOnHistoryId: string;
  let overtimeRateFieldId: string;
  let employeeRollupFieldId: string;
  let payrollLinkFieldId: string;
  let payrollRateLookupFieldId: string;
  let payrollCompanyLookupFieldId: string;
  let payrollViewId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    employeeTable = await createTable(baseId, {
      name: 'Employees',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Company',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { name: 'North Plant', color: Colors.BlueBright },
              { name: 'South Plant', color: Colors.OrangeBright },
            ],
          },
        },
      ],
      records: [
        { fields: { Name: 'Ada', Company: 'North Plant' } },
        { fields: { Name: 'Ben', Company: 'South Plant' } },
      ],
    });

    rateHistoryTable = await createTable(baseId, {
      name: 'Rate History',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [],
    });

    const historyLink = await createField(rateHistoryTable.id, {
      name: 'Employee',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: employeeTable.id,
      },
    });
    employeeLinkOnHistoryId = historyLink.id;

    const overtimeRate = await createField(rateHistoryTable.id, {
      name: 'Overtime Rate',
      type: FieldType.Number,
      options: {
        formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      },
    });
    overtimeRateFieldId = overtimeRate.id;

    const employeeFields = await getFields(employeeTable.id);
    const employeeSymmetricLink = employeeFields.find((field) => field.type === FieldType.Link);
    if (!employeeSymmetricLink) {
      throw new Error('Missing symmetric employee link');
    }

    const employeeRollup = await createField(employeeTable.id, {
      name: 'Overtime Rate',
      type: FieldType.Rollup,
      options: {
        expression: 'max({values})',
        timeZone: 'Asia/Shanghai',
        formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      },
      lookupOptions: {
        foreignTableId: rateHistoryTable.id,
        lookupFieldId: overtimeRateFieldId,
        linkFieldId: employeeSymmetricLink.id,
      },
    });
    employeeRollupFieldId = employeeRollup.id;

    payrollTable = await createTable(baseId, {
      name: 'Payroll',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [],
    });

    const payrollLink = await createField(payrollTable.id, {
      name: 'Employee',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: employeeTable.id,
        isOneWay: true,
      },
    });
    payrollLinkFieldId = payrollLink.id;

    const companyLookup = await createField(payrollTable.id, {
      name: 'Company',
      type: FieldType.SingleSelect,
      isLookup: true,
      lookupOptions: {
        foreignTableId: employeeTable.id,
        lookupFieldId: employeeTable.fields.find((field) => field.name === 'Company')!.id,
        linkFieldId: payrollLinkFieldId,
      },
    });
    payrollCompanyLookupFieldId = companyLookup.id;

    const rateLookup = await createField(payrollTable.id, {
      name: 'Overtime Rate Lookup',
      type: FieldType.Rollup,
      isLookup: true,
      options: {
        expression: 'max({values})',
        timeZone: 'Asia/Shanghai',
        formatting: { type: NumberFormattingType.Decimal, precision: 0 },
      },
      lookupOptions: {
        foreignTableId: employeeTable.id,
        lookupFieldId: employeeRollupFieldId,
        linkFieldId: payrollLinkFieldId,
      },
    });
    payrollRateLookupFieldId = rateLookup.id;

    await createRecords(rateHistoryTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [rateHistoryTable.fields[0].id]: 'Ada-2026-01',
            [employeeLinkOnHistoryId]: { id: employeeTable.records[0].id },
            [overtimeRateFieldId]: 40,
          },
        },
      ],
    });

    await createRecords(payrollTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [payrollTable.fields[0].id]: 'Ada-Jan',
            [payrollLinkFieldId]: { id: employeeTable.records[0].id },
          },
        },
      ],
    });

    const view = await createView(payrollTable.id, {
      name: 'Unpaid',
      type: 'grid',
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: payrollCompanyLookupFieldId,
            operator: 'isAnyOf',
            value: ['North Plant', 'South Plant'],
          },
        ],
      },
      sort: {
        sortObjs: [{ fieldId: payrollCompanyLookupFieldId, order: 'asc' }],
        manualSort: false,
      },
    });
    payrollViewId = view.id;
  });

  afterAll(async () => {
    if (payrollTable?.id) await permanentDeleteTable(baseId, payrollTable.id);
    if (rateHistoryTable?.id) await permanentDeleteTable(baseId, rateHistoryTable.id);
    if (employeeTable?.id) await permanentDeleteTable(baseId, employeeTable.id);
    await app.close();
  });

  it('lists payroll records for a view that filters a lookup of rollup graph', async () => {
    const records = await getRecords(payrollTable.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: payrollViewId,
    });

    expect(records.records).toHaveLength(1);
    expect(records.records[0].fields[payrollRateLookupFieldId]).toEqual(40);
    expect(records.records[0].fields[payrollCompanyLookupFieldId]).toEqual('North Plant');
  });

  it('creates a rate-history record that feeds the employee rollup', async () => {
    const created = await createRecords(rateHistoryTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: {
            [rateHistoryTable.fields[0].id]: 'Ben-2026-01',
            [employeeLinkOnHistoryId]: { id: employeeTable.records[1].id },
            [overtimeRateFieldId]: 36,
          },
        },
      ],
    });

    expect(created.records).toHaveLength(1);
  });
});
