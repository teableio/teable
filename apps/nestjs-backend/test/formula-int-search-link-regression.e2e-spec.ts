import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { DriverClient, FieldType, Relationship } from '@teable/core';
import {
  createField,
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Formula INT(SEARCH(..)>0) on link fields regression (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  async function waitForFormulaValue(opts: {
    tableId: string;
    recordId: string;
    fieldId: string;
    expected: number;
  }) {
    const startedAt = Date.now();
    // Formula computation is async; poll a little to avoid flaky assertions.
    while (Date.now() - startedAt < 3000) {
      const record = await getRecord(opts.tableId, opts.recordId);
      if (record.fields?.[opts.fieldId] === opts.expected) {
        return record;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const record = await getRecord(opts.tableId, opts.recordId);
    expect(record.fields?.[opts.fieldId]).toBe(opts.expected);
    return record;
  }

  it.skipIf(globalThis.testConfig.driver !== DriverClient.Pg)(
    'does not error with "cannot cast type double precision to boolean" during computed updates',
    async () => {
      let foreignTableId: string | undefined;
      let mainTableId: string | undefined;

      try {
        const foreign = await createTable(baseId, {
          name: 'formula-int-search-link-foreign',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
          records: [{ fields: { Title: '终止合同' } }, { fields: { Title: '持续合同' } }],
        });
        foreignTableId = foreign.id;

        const main = await createTable(baseId, {
          name: 'formula-int-search-link-main',
          records: [],
        });
        mainTableId = main.id;

        const link = await createField(main.id, {
          name: 'Contract',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyOne, foreignTableId: foreign.id },
        } as IFieldRo);

        const formula = await createField(main.id, {
          name: 'HasTerminated',
          type: FieldType.Formula,
          options: {
            expression: `INT(SEARCH('终止',{${link.id}})>0)`,
          },
        } as IFieldRo);

        const created = await createRecords(main.id, {
          records: [{ fields: { [link.id]: { id: foreign.records[0].id } } }],
        });
        const recordId = created.records[0].id;

        await waitForFormulaValue({
          tableId: main.id,
          recordId,
          fieldId: formula.id,
          expected: 1,
        });

        await updateRecordByApi(main.id, recordId, link.id, { id: foreign.records[1].id });
        await waitForFormulaValue({
          tableId: main.id,
          recordId,
          fieldId: formula.id,
          expected: 0,
        });
      } finally {
        if (mainTableId) {
          await permanentDeleteTable(baseId, mainTableId);
        }
        if (foreignTableId) {
          await permanentDeleteTable(baseId, foreignTableId);
        }
      }
    }
  );
});
