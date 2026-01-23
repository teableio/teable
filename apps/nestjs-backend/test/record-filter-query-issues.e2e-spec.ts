/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFilter } from '@teable/core';
import { and, FieldKeyType, FieldType, is } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { createField, getRecords as apiGetRecords } from '@teable/openapi';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('OpenAPI Record-Filter-Query Issues (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  async function getFilterRecord(tableId: string, viewId: string, filter: IFilter) {
    return (
      await apiGetRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        filter: filter,
      })
    ).data;
  }

  // T1613: Boolean field filter not working correctly for formula fields
  describe('T1613: filter boolean field with is operator', () => {
    describe('boolean formula field', () => {
      let table: ITableFullVo;
      const numberFieldName = 'Number';

      beforeAll(async () => {
        table = await createTable(baseId, {
          name: 'boolean_formula_filter_test',
          fields: [
            {
              name: numberFieldName,
              type: FieldType.Number,
              options: { formatting: { type: 'decimal', precision: 0 } },
            },
          ],
          records: [
            { fields: { [numberFieldName]: 5 } }, // formula = true
            { fields: { [numberFieldName]: 10 } }, // formula = true
            { fields: { [numberFieldName]: 1 } }, // formula = false
            { fields: { [numberFieldName]: 2 } }, // formula = false
            { fields: { [numberFieldName]: null } }, // formula = null
            { fields: {} }, // formula = null
          ],
        });

        const numberFieldId = table.fields.find((f) => f.name === numberFieldName)!.id;
        const formulaFieldRes = await createField(table.id, {
          name: 'BooleanFormula',
          type: FieldType.Formula,
          options: { expression: `{${numberFieldId}} > 3` },
        });
        table.fields.push(formulaFieldRes.data);
      });

      afterAll(async () => {
        await permanentDeleteTable(baseId, table.id);
      });

      it('should filter is: true correctly', async () => {
        const formulaFieldId = table.fields.find((f) => f.name === 'BooleanFormula')!.id;
        const filter: IFilter = {
          filterSet: [{ fieldId: formulaFieldId, operator: is.value, value: true }],
          conjunction: and.value,
        };

        const { records } = await getFilterRecord(table.id, table.views[0].id, filter);

        expect(records.length).toBe(2);
        for (const record of records) {
          expect(record.fields[formulaFieldId]).toBe(true);
        }
      });

      it('should filter is: false correctly (including null)', async () => {
        const formulaFieldId = table.fields.find((f) => f.name === 'BooleanFormula')!.id;
        const filter: IFilter = {
          filterSet: [{ fieldId: formulaFieldId, operator: is.value, value: null }],
          conjunction: and.value,
        };

        const { records } = await getFilterRecord(table.id, table.views[0].id, filter);

        expect(records.length).toBe(4);
        for (const record of records) {
          const value = record.fields[formulaFieldId];
          expect(value === false || value === undefined || value === null).toBe(true);
        }
      });
    });

    describe('checkbox field (regression)', () => {
      let table: ITableFullVo;
      const checkboxFieldName = 'Checkbox';

      beforeAll(async () => {
        table = await createTable(baseId, {
          name: 'checkbox_filter_test',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText },
            { name: checkboxFieldName, type: FieldType.Checkbox },
          ],
          records: [
            { fields: { Title: 'A', [checkboxFieldName]: true } },
            { fields: { Title: 'B', [checkboxFieldName]: true } },
            { fields: { Title: 'C', [checkboxFieldName]: null } },
            { fields: { Title: 'D' } },
          ],
        });
      });

      afterAll(async () => {
        await permanentDeleteTable(baseId, table.id);
      });

      it('should filter is: true correctly', async () => {
        const checkboxFieldId = table.fields.find((f) => f.name === checkboxFieldName)!.id;
        const filter: IFilter = {
          filterSet: [{ fieldId: checkboxFieldId, operator: is.value, value: true }],
          conjunction: and.value,
        };

        const { records } = await getFilterRecord(table.id, table.views[0].id, filter);

        expect(records.length).toBe(2);
        for (const record of records) {
          expect(record.fields[checkboxFieldId]).toBe(true);
        }
      });

      it('should filter is: false correctly', async () => {
        const checkboxFieldId = table.fields.find((f) => f.name === checkboxFieldName)!.id;
        const filter: IFilter = {
          filterSet: [{ fieldId: checkboxFieldId, operator: is.value, value: null }],
          conjunction: and.value,
        };

        const { records } = await getFilterRecord(table.id, table.views[0].id, filter);

        expect(records.length).toBe(2);
        for (const record of records) {
          const value = record.fields[checkboxFieldId];
          expect(value === null || value === undefined).toBe(true);
        }
      });
    });
  });
});
