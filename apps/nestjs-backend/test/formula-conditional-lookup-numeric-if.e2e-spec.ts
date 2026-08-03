/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFilter, ILookupOptionsRo } from '@teable/core';
import { FieldType, getRandomString } from '@teable/core';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

/**
 * Regression: numeric formulas containing IF branches that return conditional-lookup
 * (json/jsonb array) values must coerce both branches to a numeric type. Otherwise Postgres
 * errors with "CASE types integer and jsonb cannot be matched" during computed updates.
 */
describe('Formula conditional lookup numeric IF (regression)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId as string;

  beforeAll(async () => {
    const ctx = await initApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('evaluates numeric IF branches containing conditional lookup arrays', async () => {
    const suffix = getRandomString(8);

    const foreign = await createTable(baseId, {
      name: `t1326_cl_foreign_${suffix}`,
      fields: [
        { name: 'Key', type: FieldType.SingleLineText } as IFieldRo,
        { name: 'Amount', type: FieldType.Number } as IFieldRo,
      ],
      records: [{ fields: { Key: 'A', Amount: 5 } }],
    });

    const host = await createTable(baseId, {
      name: `t1326_cl_host_${suffix}`,
      fields: [{ name: 'Key', type: FieldType.SingleLineText } as IFieldRo],
      records: [{ fields: { Key: 'A' } }, { fields: { Key: 'B' } }],
    });

    try {
      const foreignKeyFieldId = foreign.fields.find((field) => field.name === 'Key')!.id;
      const foreignAmountFieldId = foreign.fields.find((field) => field.name === 'Amount')!.id;
      const hostKeyFieldId = host.fields.find((field) => field.name === 'Key')!.id;

      const keyMatchFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: foreignKeyFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: hostKeyFieldId },
          },
        ],
      };

      const conditionalLookup = await createField(host.id, {
        name: 'Lookup Amounts',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignAmountFieldId,
          filter: keyMatchFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const formulaField = await createField(host.id, {
        name: 'Amount Delta',
        type: FieldType.Formula,
        options: {
          expression: `1 - IF({${conditionalLookup.id}}, {${conditionalLookup.id}}, 0)`,
          formatting: { type: 'decimal', precision: 2 },
        },
      } as IFieldRo);

      const recordA = await getRecord(host.id, host.records[0].id);
      const recordB = await getRecord(host.id, host.records[1].id);

      expect(recordA.fields[hostKeyFieldId]).toBe('A');
      expect(recordB.fields[hostKeyFieldId]).toBe('B');

      expect(recordA.fields[formulaField.id]).toBe(-4);
      expect(recordB.fields[formulaField.id]).toBe(1);
    } finally {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    }
  });
});
