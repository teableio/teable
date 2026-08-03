/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

/**
 * Regression: SUM over lookup-based multi-value fields should not emit malformed
 * numeric strings (e.g., "3.7525002300010774+35") when values contain scientific notation.
 * Prior to the numeric coercion fix, such inputs caused Postgres 22P02 errors during updates.
 */
describe('Formula lookup SUM numeric coercion (regression)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId as string;

  beforeAll(async () => {
    const ctx = await initApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('safely sums lookup values containing scientific-notation strings during updates', async () => {
    // Source table with text amounts (one contains scientific notation).
    const invoiceTable = await createTable(baseId, {
      name: 'sum_reg_invoices',
      fields: [{ name: 'AmountText', type: FieldType.SingleLineText }],
      records: [
        { fields: { AmountText: '5250.00' } },
        { fields: { AmountText: '4000.00' } },
        { fields: { AmountText: '3.7525002300010774e+35' } }, // would previously coerce to invalid numeric
      ],
    });
    const amountFieldId = invoiceTable.fields.find((f) => f.name === 'AmountText')!.id;

    // Target table with link -> lookup -> formula SUM
    const planTable = await createTable(baseId, {
      name: 'sum_reg_plans',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [{ fields: { Title: 'Plan A' } }],
    });

    const linkField = await createField(planTable.id, {
      name: 'Invoices',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: invoiceTable.id,
      },
    });

    const lookupField = await createField(planTable.id, {
      name: 'InvoiceAmounts',
      type: FieldType.SingleLineText, // lookup fields carry the base type and set isLookup
      isLookup: true,
      lookupOptions: {
        foreignTableId: invoiceTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: amountFieldId,
      },
    });

    const formulaField = await createField(planTable.id, {
      name: 'Total',
      type: FieldType.Formula,
      options: {
        expression: `SUM({${lookupField.id}})`,
        formatting: { precision: 2, type: 'decimal' },
      },
    });

    const planRecordId = planTable.records[0].id;

    // Link all invoice records to the plan.
    await updateRecordByApi(planTable.id, planRecordId, linkField.id, [
      { id: invoiceTable.records[0].id },
      { id: invoiceTable.records[1].id },
      { id: invoiceTable.records[2].id },
    ]);

    // Trigger an additional update to simulate the PATCH scenario from the report.
    await updateRecordByApi(planTable.id, planRecordId, planTable.fields[0].id, 'Plan A updated');

    const updated = await getRecord(planTable.id, planRecordId);
    const total = updated.fields?.[formulaField.id];

    // The scientific-notation string is ignored (coerces to NULL -> 0), valid numbers are summed.
    expect(total).toBe(9250);

    await permanentDeleteTable(baseId, planTable.id);
    await permanentDeleteTable(baseId, invoiceTable.id);
  });

  it('aggregates numeric multi-value lookups with SUM and AVERAGE', async () => {
    const scores = [95, 88, 92];
    const sourceTable = await createTable(baseId, {
      name: 'sum_reg_scores',
      fields: [
        { name: 'Assignment', type: FieldType.SingleLineText },
        { name: 'Score', type: FieldType.Number },
      ],
      records: scores.map((score, index) => ({
        fields: { Assignment: `HW ${index + 1}`, Score: score },
      })),
    });
    const scoreFieldId = sourceTable.fields.find((field) => field.name === 'Score')!.id;

    const targetTable = await createTable(baseId, {
      name: 'sum_reg_student',
      fields: [{ name: 'Student', type: FieldType.SingleLineText }],
      records: [{ fields: { Student: 'Alice' } }],
    });

    try {
      const linkField = await createField(targetTable.id, {
        name: 'Assignments',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: sourceTable.id,
        },
      });

      const lookupField = await createField(targetTable.id, {
        name: 'Scores Lookup',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: sourceTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: scoreFieldId,
        },
      });

      const sumField = await createField(targetTable.id, {
        name: 'Score Sum',
        type: FieldType.Formula,
        options: {
          expression: `SUM({${lookupField.id}})`,
        },
      });

      const avgField = await createField(targetTable.id, {
        name: 'Score Avg',
        type: FieldType.Formula,
        options: {
          expression: `AVERAGE({${lookupField.id}})`,
        },
      });

      const maxField = await createField(targetTable.id, {
        name: 'Score Max',
        type: FieldType.Formula,
        options: {
          expression: `MAX({${lookupField.id}})`,
        },
      });

      const minField = await createField(targetTable.id, {
        name: 'Score Min',
        type: FieldType.Formula,
        options: {
          expression: `MIN({${lookupField.id}})`,
        },
      });

      const targetRecordId = targetTable.records[0].id;

      await updateRecordByApi(
        targetTable.id,
        targetRecordId,
        linkField.id,
        sourceTable.records.map((record) => ({ id: record.id }))
      );

      const updated = await getRecord(targetTable.id, targetRecordId);
      const fields = updated.fields ?? {};

      const expectedSum = scores.reduce((acc, value) => acc + value, 0);
      const expectedAvg = expectedSum / scores.length;
      const expectedMax = Math.max(...scores);
      const expectedMin = Math.min(...scores);

      expect(fields[sumField.id]).toBeCloseTo(expectedSum, 6);
      expect(fields[avgField.id]).toBeCloseTo(expectedAvg, 6);
      expect(fields[maxField.id]).toBeCloseTo(expectedMax, 6);
      expect(fields[minField.id]).toBeCloseTo(expectedMin, 6);
    } finally {
      await permanentDeleteTable(baseId, targetTable.id);
      await permanentDeleteTable(baseId, sourceTable.id);
    }
  });
});
