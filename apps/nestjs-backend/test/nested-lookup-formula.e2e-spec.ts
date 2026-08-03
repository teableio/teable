/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILookupOptionsRo, INumberFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, NumberFormattingType } from '@teable/core';
import {
  createField,
  createTable,
  getFields,
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
      options: { formatting: { type: 'decimal', precision: 0 } } as INumberFieldOptions,
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

  it('resolves lookup of a rollup-driven formula across the same link chain', async () => {
    const projectTable = await createTable(baseId, {
      name: 'Projects',
      fields: [
        {
          name: 'Project Name',
          type: FieldType.SingleLineText,
          options: {},
        },
      ],
      records: [{ fields: {} }],
    });

    const taskTable = await createTable(baseId, {
      name: 'Tasks',
      fields: [
        {
          name: 'Task Name',
          type: FieldType.SingleLineText,
          options: {},
        },
        {
          name: 'Hours',
          type: FieldType.Number,
          options: {
            formatting: {
              type: NumberFormattingType.Decimal,
              precision: 0,
            },
          },
        },
      ],
      records: [{ fields: {} }, { fields: {} }],
    });

    try {
      const projectNameFieldId = projectTable.fields.find((f) => f.name === 'Project Name')!.id;
      const taskNameFieldId = taskTable.fields.find((f) => f.name === 'Task Name')!.id;
      const hoursFieldId = taskTable.fields.find((f) => f.name === 'Hours')!.id;

      await updateRecordByApi(
        projectTable.id,
        projectTable.records[0].id,
        projectNameFieldId,
        'Alpha'
      );
      await updateRecordByApi(taskTable.id, taskTable.records[0].id, taskNameFieldId, 'Design');
      await updateRecordByApi(taskTable.id, taskTable.records[1].id, taskNameFieldId, 'Review');
      await updateRecordByApi(taskTable.id, taskTable.records[0].id, hoursFieldId, 4);
      await updateRecordByApi(taskTable.id, taskTable.records[1].id, hoursFieldId, 6);

      const projectToTaskLink = await createField(projectTable.id, {
        name: 'Tasks link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: taskTable.id,
        },
      });

      const taskFieldsAfterLink = await getFields(taskTable.id);
      const taskToProjectLink = taskFieldsAfterLink.find(
        (field) =>
          field.type === FieldType.Link &&
          (field.options as { foreignTableId?: string }).foreignTableId === projectTable.id
      );
      expect(taskToProjectLink).toBeDefined();

      const sumRollup = await createField(projectTable.id, {
        name: 'Total Hours',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: taskTable.id,
          linkFieldId: projectToTaskLink.id,
          lookupFieldId: hoursFieldId,
        },
      });

      const countRollup = await createField(projectTable.id, {
        name: 'Task Count',
        type: FieldType.Rollup,
        options: {
          expression: 'counta({values})',
        },
        lookupOptions: {
          foreignTableId: taskTable.id,
          linkFieldId: projectToTaskLink.id,
          lookupFieldId: hoursFieldId,
        },
      });

      const rollupFormula = await createField(projectTable.id, {
        name: 'Effort Index',
        type: FieldType.Formula,
        options: {
          expression: `({${sumRollup.id}} + {${countRollup.id}}) / 2`,
        },
      } as unknown as IFieldRo);

      const projectRollupLookup = await createField(taskTable.id, {
        name: 'Project Effort',
        type: FieldType.Formula,
        isLookup: true,
        lookupOptions: {
          foreignTableId: projectTable.id,
          linkFieldId: taskToProjectLink!.id,
          lookupFieldId: rollupFormula.id,
        },
      } as unknown as IFieldRo);

      await updateRecordByApi(projectTable.id, projectTable.records[0].id, projectToTaskLink.id, [
        { id: taskTable.records[0].id },
        { id: taskTable.records[1].id },
      ]);

      const res = await getRecords(taskTable.id, { fieldKeyType: FieldKeyType.Id });
      expect(res.records).toHaveLength(2);
      const expectedValue = (4 + 6 + 2) / 2;
      for (const record of res.records) {
        expect(record.fields[projectRollupLookup.id]).toBeCloseTo(expectedValue);
      }
    } finally {
      await permanentDeleteTable(baseId, taskTable.id);
      await permanentDeleteTable(baseId, projectTable.id);
    }
  });
});
