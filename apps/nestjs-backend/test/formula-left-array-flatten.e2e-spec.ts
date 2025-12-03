import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import {
  createField,
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Formula LEFT with ARRAY_FLATTEN parameters (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the substring when earlier ARRAY_FLATTEN params are blank but later ones are populated', async () => {
    let tableId: string | undefined;

    try {
      const table = await createTable(baseId, {
        name: 'formula-left-array-flatten',
        fields: [
          { name: 'LeadingEmpty', type: FieldType.SingleLineText },
          { name: 'TrailingValue', type: FieldType.SingleLineText },
        ],
      });
      tableId = table.id;

      const leadingField = table.fields.find((f) => f.name === 'LeadingEmpty')!;
      const trailingField = table.fields.find((f) => f.name === 'TrailingValue')!;

      const joined = await createField(tableId, {
        name: 'Joined',
        type: FieldType.Formula,
        options: {
          expression: `ARRAY_JOIN(ARRAY_FLATTEN({${leadingField.id}},{${trailingField.id}}), ".")`,
        },
      });

      const marker = await createField(tableId, {
        name: 'Marker',
        type: FieldType.Formula,
        options: {
          expression: `LEFT({${joined.id}}, 7)`,
        },
      });

      const sample = 'ABCDEF123';
      const { records } = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { TrailingValue: sample } }],
      });

      const recordId = records[0].id;

      // Allow asynchronous formula computation to settle
      await new Promise((resolve) => setTimeout(resolve, 200));

      const record = await getRecord(tableId, recordId);
      expect(record.fields[joined.id]).toBe(sample);
      expect(record.fields[marker.id]).toBe(sample.slice(0, 7));
    } finally {
      if (tableId) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });
});
