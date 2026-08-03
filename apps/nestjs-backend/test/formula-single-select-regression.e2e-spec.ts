/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { duplicateField } from '@teable/openapi';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  createRecords,
  updateRecordByApi,
} from './utils/init-app';

describe('Formula single select string comparison regression (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('duplicate formulas comparing single select + text', () => {
    let table: ITableFullVo;
    let prevField: IFieldVo;
    let availabilityField: IFieldVo;
    let primaryFormula: IFieldVo;
    let copyFormula: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula_select_copy_regression',
        fields: [
          {
            name: 'Prev Status',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Availability',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'In Stock', color: 'grayBright' },
                { name: 'Not Available', color: 'pink' },
                { name: 'Low Stock', color: 'yellowLight1' },
              ],
            },
          },
        ],
        records: [
          {
            fields: {
              'Prev Status': 'In Stock',
              Availability: 'Not Available',
            },
          },
          {
            fields: {
              'Prev Status': 'In Stock',
              Availability: 'In Stock',
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((f) => [f.name, f]));
      prevField = fieldMap.get('Prev Status')!;
      availabilityField = fieldMap.get('Availability')!;

      const expression = `IF(AND({${prevField.id}} != "Not Available", {${availabilityField.id}} = "Not Available"), "yes", BLANK())`;

      primaryFormula = await createField(table.id, {
        name: 'some field',
        type: FieldType.Formula,
        options: { expression },
      });

      copyFormula = (
        await duplicateField(table.id, primaryFormula.id, {
          name: 'some field copy',
        })
      ).data;
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('evaluates identical formulas the same when comparing select titles', async () => {
      const discontinuedRecord = await getRecord(table.id, table.records[0].id);
      expect(discontinuedRecord.fields[primaryFormula.id]).toBe('yes');
      expect(discontinuedRecord.fields[copyFormula.id]).toBe('yes');

      const stockedRecord = await getRecord(table.id, table.records[1].id);
      expect(stockedRecord.fields[primaryFormula.id]).toBeUndefined();
      expect(stockedRecord.fields[copyFormula.id]).toBeUndefined();

      await updateRecordByApi(table.id, table.records[1].id, availabilityField.id, 'Not Available');

      const afterUpdate = await getRecord(table.id, table.records[1].id);
      expect(afterUpdate.fields[primaryFormula.id]).toBe('yes');
      expect(afterUpdate.fields[copyFormula.id]).toBe('yes');
    });
  });

  describe('text != literal with null title value', () => {
    let table: ITableFullVo;
    let titleField: IFieldVo;
    let branchField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'formula_text_not_equal_blank',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
        ],
      });

      titleField = table.fields.find((f) => f.name === 'Title')!;

      branchField = await createField(table.id, {
        name: 'branch',
        type: FieldType.Formula,
        options: {
          expression: `IF({${titleField.id}} != "hello", "world", "this")`,
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('treats null text as blank when evaluating !=', async () => {
      const { records } = await createRecords(table.id, {
        records: [{ fields: {} }],
      });

      const created = await getRecord(table.id, records[0].id);
      expect(created.fields[branchField.id]).toBe('world');

      await updateRecordByApi(table.id, records[0].id, titleField.id, 'hello');
      const helloRecord = await getRecord(table.id, records[0].id);
      expect(helloRecord.fields[branchField.id]).toBe('this');

      await updateRecordByApi(table.id, records[0].id, titleField.id, null);
      const clearedRecord = await getRecord(table.id, records[0].id);
      expect(clearedRecord.fields[branchField.id]).toBe('world');
    });
  });
});
