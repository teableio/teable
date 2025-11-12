/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Generated column numeric coercion (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('text fields in arithmetic formulas', () => {
    let table: ITableFullVo;
    let durationField: IFieldVo;
    let consumedField: IFieldVo;
    let remainingField: IFieldVo;
    let progressField: IFieldVo;

    beforeEach(async () => {
      const seedFields: IFieldRo[] = [
        {
          name: 'Planned Duration',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Consumed Days',
          type: FieldType.SingleLineText,
        },
      ];

      table = await createTable(baseId, {
        name: 'generated_numeric_coercion',
        fields: seedFields,
        records: [
          {
            fields: {
              'Planned Duration': '10天',
              'Consumed Days': '3',
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
      durationField = fieldMap.get('Planned Duration')!;
      consumedField = fieldMap.get('Consumed Days')!;

      remainingField = await createField(table.id, {
        name: 'Remaining Days',
        type: FieldType.Formula,
        options: {
          expression: `{${durationField.id}} - {${consumedField.id}}`,
        },
      });

      progressField = await createField(table.id, {
        name: 'Progress',
        type: FieldType.Formula,
        options: {
          expression: `{${consumedField.id}} / {${durationField.id}}`,
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('coerces numeric strings when updating generated columns', async () => {
      const recordId = table.records[0].id;

      const createdRecord = await getRecord(table.id, recordId);
      expect(createdRecord.fields[remainingField.id]).toBe(7);
      expect(createdRecord.fields[progressField.id]).toBeCloseTo(3 / 10, 2);

      await expect(
        updateRecordByApi(table.id, recordId, consumedField.id, '4天')
      ).resolves.toBeDefined();

      const updatedRecord = await getRecord(table.id, recordId);
      expect(updatedRecord.fields[remainingField.id]).toBe(6);
      expect(updatedRecord.fields[progressField.id]).toBeCloseTo(4 / 10, 2);

      await expect(
        updateRecordByApi(table.id, recordId, durationField.id, '12周')
      ).resolves.toBeDefined();

      const finalRecord = await getRecord(table.id, recordId);
      expect(finalRecord.fields[remainingField.id]).toBe(8);
      expect(finalRecord.fields[progressField.id]).toBeCloseTo(4 / 12, 2);
    });
  });

  describe('blank arithmetic operands', () => {
    let table: ITableFullVo;
    let valueField: IFieldVo;
    let optionalField: IFieldVo;
    let addField: IFieldVo;
    let subtractField: IFieldVo;
    let multiplyField: IFieldVo;
    let divideValueByOptionalField: IFieldVo;
    let divideOptionalByValueField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'generated_blank_arithmetic',
        fields: [
          {
            name: 'Value',
            type: FieldType.Number,
          },
          {
            name: 'Optional',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              Value: 10,
            },
          },
          {
            fields: {
              Optional: 4,
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
      valueField = fieldMap.get('Value')!;
      optionalField = fieldMap.get('Optional')!;

      addField = await createField(table.id, {
        name: 'Add',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} + {${optionalField.id}}`,
        },
      });

      subtractField = await createField(table.id, {
        name: 'Subtract',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} - {${optionalField.id}}`,
        },
      });

      multiplyField = await createField(table.id, {
        name: 'Multiply',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} * {${optionalField.id}}`,
        },
      });

      divideValueByOptionalField = await createField(table.id, {
        name: 'Value / Optional',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} / {${optionalField.id}}`,
        },
      });

      divideOptionalByValueField = await createField(table.id, {
        name: 'Optional / Value',
        type: FieldType.Formula,
        options: {
          expression: `{${optionalField.id}} / {${valueField.id}}`,
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('treats blank operands as zero in arithmetic formulas', async () => {
      const [valueOnlyRecord, optionalOnlyRecord] = table.records;

      const recordWithValue = await getRecord(table.id, valueOnlyRecord.id);
      expect(recordWithValue.fields[addField.id]).toBe(10);
      expect(recordWithValue.fields[subtractField.id]).toBe(10);
      expect(recordWithValue.fields[multiplyField.id]).toBe(0);
      expect(recordWithValue.fields[divideOptionalByValueField.id]).toBe(0);
      expect(recordWithValue.fields[divideValueByOptionalField.id]).toBeUndefined();

      const recordWithOptional = await getRecord(table.id, optionalOnlyRecord.id);
      expect(recordWithOptional.fields[addField.id]).toBe(4);
      expect(recordWithOptional.fields[subtractField.id]).toBe(-4);
      expect(recordWithOptional.fields[multiplyField.id]).toBe(0);
      expect(recordWithOptional.fields[divideValueByOptionalField.id]).toBe(0);
      expect(recordWithOptional.fields[divideOptionalByValueField.id]).toBeUndefined();
    });
  });
});
