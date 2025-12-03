/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
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

describe('Generated column BLANK() branch stays null (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('IF + BLANK generated column', () => {
    let table: ITableFullVo;
    let statusAField: IFieldVo;
    let statusBField: IFieldVo;
    let markerField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'generated_blank_if',
        fields: [
          {
            name: 'Status A',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Status B',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          {
            fields: {
              'Status A': 'Not Available',
              'Status B': 'In Stock',
            },
          },
          {
            fields: {
              'Status A': 'Available',
              'Status B': 'Not Available',
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((f) => [f.name, f]));
      statusAField = fieldMap.get('Status A')!;
      statusBField = fieldMap.get('Status B')!;

      markerField = await createField(table.id, {
        name: 'Restock Marker',
        type: FieldType.Formula,
        options: {
          expression: `IF(AND({${statusAField.id}} = "Not Available", {${statusBField.id}} != "Not Available"), "是", BLANK())`,
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('persists null (not empty string) when BLANK branch executes', async () => {
      const [restockRecord, unavailableRecord] = table.records;

      const freshRestock = await getRecord(table.id, restockRecord.id);
      expect(freshRestock.fields[markerField.id]).toBe('是');

      const freshUnavailable = await getRecord(table.id, unavailableRecord.id);
      expect(freshUnavailable.fields[markerField.id]).toBeUndefined();

      await expect(
        updateRecordByApi(table.id, restockRecord.id, statusBField.id, 'Not Available')
      ).resolves.toBeDefined();

      const afterToggle = await getRecord(table.id, restockRecord.id);
      expect(afterToggle.fields[markerField.id]).toBeUndefined();
    });
  });
});
