/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Formula boolean numeric coercion (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('compares checkbox values against numeric literals', async () => {
    const fields: IFieldRo[] = [
      {
        name: 'Name',
        type: FieldType.SingleLineText,
      },
      {
        name: 'Notified',
        type: FieldType.Checkbox,
      },
    ];

    const table = await createTable(baseId, {
      name: 'formula_boolean_numeric_coercion',
      fields,
      records: [
        { fields: { Name: 'row-1', Notified: true } },
        { fields: { Name: 'row-2', Notified: false } },
      ],
    });

    try {
      const fieldMap = new Map<string, IFieldVo>(table.fields.map((f) => [f.name, f]));
      const checkboxField = fieldMap.get('Notified')!;

      const formulaField = await createField(table.id, {
        name: 'Notify Status',
        type: FieldType.Formula,
        options: {
          expression: `IF({${checkboxField.id}} = 1, 'already', 'pending')`,
        },
      });

      const firstRecord = await getRecord(table.id, table.records[0].id);
      expect(firstRecord.fields[formulaField.id]).toBe('already');

      const secondRecord = await getRecord(table.id, table.records[1].id);
      expect(secondRecord.fields[formulaField.id]).toBe('pending');

      await updateRecordByApi(table.id, table.records[1].id, checkboxField.id, true);
      const updatedRecord = await getRecord(table.id, table.records[1].id);
      expect(updatedRecord.fields[formulaField.id]).toBe('already');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
