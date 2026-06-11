import type { INestApplication } from '@nestjs/common';
import {
  CellFormat,
  FieldType,
  NumberFormattingType,
  Relationship,
  type LinkFieldCore,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  deleteTable,
  getRecord,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

const waitForRecalc = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Number precision (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo | undefined;
  let childTable: ITableFullVo | undefined;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterEach(async () => {
    if (table) {
      await deleteTable(baseId, table.id);
      table = undefined;
    }
    if (childTable) {
      await deleteTable(baseId, childTable.id);
      childTable = undefined;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps decimal precision on formula fields and respects string formatting', async () => {
    table = await createTable(baseId, {
      name: 'precision-formula',
      fields: [
        {
          name: 'Hours',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
        },
        {
          name: 'Rate',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
        },
      ],
      records: [{ fields: { Hours: 10.1, Rate: 3 } }],
    });

    const grossField = await createField(table.id, {
      name: 'GrossPay',
      type: FieldType.Formula,
      options: {
        expression: `{${table.fields[0].id}} * {${table.fields[1].id}}`,
        formatting: { type: NumberFormattingType.Decimal, precision: 2 },
      },
    });
    await waitForRecalc();

    const record = await getRecord(table.id, table.records[0].id);
    const grossValue = record.fields[grossField.id] as number;
    expect(grossValue).toBeCloseTo(30.3, 8);

    const textRecord = await getRecord(table.id, table.records[0].id, CellFormat.Text);
    expect(textRecord.fields[grossField.id]).toBe('30.30');
  });

  it('keeps rollup sums stable with decimal inputs', async () => {
    table = await createTable(baseId, {
      name: 'precision-invoice',
      fields: [{ name: 'Invoice', type: FieldType.SingleLineText }],
      records: [{ fields: { Invoice: 'INV-001' } }],
    });

    childTable = await createTable(baseId, {
      name: 'precision-items',
      fields: [
        { name: 'Item', type: FieldType.SingleLineText },
        {
          name: 'Amount',
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
        },
      ],
      records: [
        { fields: { Item: 'Line 1', Amount: 10.1 } },
        { fields: { Item: 'Line 2', Amount: 20.2 } },
      ],
    });

    const linkField = (await createField(childTable.id, {
      name: 'InvoiceLink',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: table.id,
      },
    })) as LinkFieldCore;

    const symmetricFieldId = linkField.options.symmetricFieldId;
    if (!symmetricFieldId) {
      throw new Error('symmetric field not created');
    }

    const rollupField = await createField(table.id, {
      name: 'Total',
      type: FieldType.Rollup,
      options: { expression: 'sum({values})' },
      lookupOptions: {
        foreignTableId: childTable.id,
        linkFieldId: symmetricFieldId,
        lookupFieldId: childTable.fields.find((f) => f.name === 'Amount')!.id,
      },
    });

    for (const record of childTable.records) {
      await updateRecordByApi(childTable.id, record.id, linkField.id, { id: table.records[0].id });
    }
    await waitForRecalc();

    const invoiceRecord = await getRecord(table.id, table.records[0].id);
    const totalValue = invoiceRecord.fields[rollupField.id] as number;
    expect(totalValue).toBeCloseTo(30.3, 8);

    const totalText = await getRecord(table.id, table.records[0].id, CellFormat.Text);
    expect(totalText.fields[rollupField.id]).toBe('30.30');
  });
});
