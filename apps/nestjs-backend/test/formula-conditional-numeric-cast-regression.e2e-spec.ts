/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, generateFieldId } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('Formula conditional numeric cast safety (regression)', () => {
  const isForceV2 = process.env.FORCE_V2_ALL === 'true';
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId as string;

  beforeAll(async () => {
    const ctx = await initApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it.skipIf(isForceV2)(
    'creates rows successfully when conditional formulas compare malformed numeric text',
    async () => {
      const displayPriceFieldId = generateFieldId();
      const table = (await createTable(baseId, {
        name: 'formula_conditional_numeric_cast_regression',
        fields: [
          {
            id: displayPriceFieldId,
            name: 'DisplayPrice',
            type: FieldType.SingleLineText,
          },
          {
            name: 'MemberContribution',
            type: FieldType.Formula,
            options: {
              expression: `(IF({${displayPriceFieldId}} < 40, 3, IF({${displayPriceFieldId}} < 50, 4, IF({${displayPriceFieldId}} < 75, 5, 8)))) * 1.6`,
            },
          },
        ],
      })) as ITableFullVo;

      try {
        await createRecords(table.id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                DisplayPrice: '39.9339.93',
              },
            },
            {
              fields: {
                DisplayPrice: '39.93',
              },
            },
          ],
        });

        const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Name });

        const targetRecords = records.filter((record) => {
          const displayPrice = record.fields.DisplayPrice;
          return displayPrice === '39.9339.93' || displayPrice === '39.93';
        });

        expect(targetRecords).toHaveLength(2);
        const malformedNumericRecord = targetRecords.find(
          (record) => record.fields.DisplayPrice === '39.9339.93'
        );
        const validNumericRecord = targetRecords.find(
          (record) => record.fields.DisplayPrice === '39.93'
        );

        expect(malformedNumericRecord?.fields.MemberContribution).toBeCloseTo(12.8, 6);
        expect(validNumericRecord?.fields.MemberContribution).toBeCloseTo(4.8, 6);
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    }
  );
});
