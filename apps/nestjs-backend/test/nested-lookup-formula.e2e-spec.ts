/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILookupOptionsRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getRecords,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

/**
 * Covers: lookup(Table3 -> Table2) of a lookup(Table2 -> Table1) whose target is a Formula on Table1
 * Ensures nested CTEs are generated and NULL polymorphic issues are avoided in PG.
 */
describe('Nested Lookup via Formula target (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns values for lookup->lookup(formula) chain', async () => {
    // Table1 with a number and a formula that references the number
    const numberField: IFieldRo = {
      name: 'Count',
      type: FieldType.Number,
      options: { formatting: { type: 'decimal', precision: 0 } },
    };

    const table1 = await createTable(baseId, {
      name: 'T1',
      fields: [numberField],
      records: [{ fields: { Count: 10 } }, { fields: { Count: 20 } }],
    });
    const countFieldId = table1.fields.find((f) => f.name === 'Count')!.id;
    const answerField = await createField(table1.id, {
      name: 'Answer',
      type: FieldType.Formula,
      options: { expression: `{${countFieldId}}` },
    } as any);

    // Table2 with link -> T1 and lookup of T1.Answer (formula)
    const table2 = await createTable(baseId, { name: 'T2', fields: [], records: [{ fields: {} }] });
    const link2to1 = await createField(table2.id, {
      name: 'Link T1',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: table1.id },
    });
    const lookup2: IFieldRo = {
      name: 'Lookup Answer',
      type: FieldType.Formula,
      isLookup: true,
      lookupOptions: {
        foreignTableId: table1.id,
        linkFieldId: link2to1.id,
        lookupFieldId: (answerField as any).id,
      } as ILookupOptionsRo,
    } as any;
    const table2Lookup = await createField(table2.id, lookup2);

    // Table3 with link -> T2 and lookup of T2.Lookup Answer
    const table3 = await createTable(baseId, { name: 'T3', fields: [], records: [{ fields: {} }] });
    const link3to2 = await createField(table3.id, {
      name: 'Link T2',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: table2.id },
    });
    const lookup3: IFieldRo = {
      name: 'Nested Lookup',
      type: FieldType.Formula,
      isLookup: true,
      lookupOptions: {
        foreignTableId: table2.id,
        linkFieldId: link3to2.id,
        lookupFieldId: table2Lookup.id,
      } as ILookupOptionsRo,
    } as any;
    const table3Lookup = await createField(table3.id, lookup3);

    // Establish relationships
    await updateRecordByApi(table2.id, table2.records[0].id, link2to1.id, [
      { id: table1.records[0].id },
      { id: table1.records[1].id },
    ]);
    await updateRecordByApi(table3.id, table3.records[0].id, link3to2.id, [
      { id: table2.records[0].id },
    ]);

    const res = await getRecords(table3.id, { fieldKeyType: FieldKeyType.Id });
    const record = res.records[0];
    const val = record.fields[table3Lookup.id];
    expect(val).toEqual(expect.arrayContaining([10, 20]));

    // Cleanup
    await permanentDeleteTable(baseId, table3.id);
    await permanentDeleteTable(baseId, table2.id);
    await permanentDeleteTable(baseId, table1.id);
  });
});
