/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  getField,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Select formula numeric coercion (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('coerces numeric strings when evaluating select formulas', async () => {
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

    const table: ITableFullVo = await createTable(baseId, {
      name: 'select_numeric_coercion',
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

    try {
      const fieldMap = new Map<string, IFieldVo>(table.fields.map((field) => [field.name, field]));
      const durationField = fieldMap.get('Planned Duration')!;
      const consumedField = fieldMap.get('Consumed Days')!;

      const remainingField = await createField(table.id, {
        name: 'Remaining Days (runtime)',
        type: FieldType.Formula,
        options: {
          expression: `{${durationField.id}} - {${consumedField.id}}`,
        },
      });

      const negativeField = await createField(table.id, {
        name: 'Negative Consumed (runtime)',
        type: FieldType.Formula,
        options: {
          expression: `-{${consumedField.id}}`,
        },
      });

      const refreshedRemaining = await getField(table.id, remainingField.id);
      const remainingMeta =
        typeof refreshedRemaining.meta === 'string'
          ? (JSON.parse(refreshedRemaining.meta) as { persistedAsGeneratedColumn?: boolean })
          : (refreshedRemaining.meta as { persistedAsGeneratedColumn?: boolean } | undefined);
      expect(remainingMeta?.persistedAsGeneratedColumn).not.toBe(true);

      const recordId = table.records[0].id;

      const initialRecord = await getRecord(table.id, recordId);
      expect(initialRecord.fields[remainingField.id]).toBe(7);
      expect(initialRecord.fields[negativeField.id]).toBe(-3);

      await expect(
        updateRecordByApi(table.id, recordId, consumedField.id, '4天')
      ).resolves.toBeDefined();

      const updatedRecord = await getRecord(table.id, recordId);
      expect(updatedRecord.fields[remainingField.id]).toBe(6);
      expect(updatedRecord.fields[negativeField.id]).toBe(-4);
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
