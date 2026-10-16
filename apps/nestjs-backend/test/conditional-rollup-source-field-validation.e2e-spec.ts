/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { INestApplication } from '@nestjs/common';
import type { IConditionalRollupFieldOptions, IFieldRo, IHttpError } from '@teable/core';
import { FieldKeyType, FieldType, HttpErrorCode } from '@teable/core';
import { createField as apiCreateField } from '@teable/openapi';
import {
  createField,
  createTable,
  getFields,
  getRecords,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

/**
 * T7803 — a conditionalRollup whose lookupFieldId belongs to another table must be
 * rejected as a request-validation error (400), not a leaked 404 not-found.
 */
describe('OpenAPI Conditional Rollup source field ownership (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  const withForceV2All = async <T>(callback: () => Promise<T>) => {
    const previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    try {
      return await callback();
    } finally {
      if (previousForceV2All === undefined) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    }
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a source field that belongs to another table and creates no field', async () => {
    await withForceV2All(async () => {
      const products = await createTable(baseId, {
        name: 'CondRollupCrossTable_Products',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Price', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Name: 'Apple', Price: 10 } },
          { fields: { Name: 'Banana', Price: 20 } },
        ],
      });
      const customers = await createTable(baseId, {
        name: 'CondRollupCrossTable_Customers',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Points', type: FieldType.Number } as IFieldRo,
        ],
      });
      const orders = await createTable(baseId, {
        name: 'CondRollupCrossTable_Orders',
        fields: [{ name: 'OrderNo', type: FieldType.SingleLineText } as IFieldRo],
      });

      const priceFieldId = products.fields.find((field) => field.name === 'Price')!.id;
      const pointsFieldId = customers.fields.find((field) => field.name === 'Points')!.id;

      try {
        let captured: IHttpError | undefined;
        try {
          await apiCreateField(orders.id, {
            name: 'CrossTableRollup',
            type: FieldType.ConditionalRollup,
            options: {
              foreignTableId: products.id,
              // Points lives in the customers table, not in the products table.
              lookupFieldId: pointsFieldId,
              expression: 'sum({values})',
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: priceFieldId, operator: 'isGreater', value: 0 }],
              },
            } as IConditionalRollupFieldOptions,
          } as IFieldRo);
        } catch (error) {
          captured = error as IHttpError;
        }

        expect(captured?.status).toBe(400);
        expect(captured?.code).toBe(HttpErrorCode.VALIDATION_ERROR);
        const errorData =
          captured?.data && typeof captured.data === 'object'
            ? (captured.data as Record<string, unknown>)
            : undefined;
        expect(errorData?.domainCode).toBe(
          'conditional_rollup.lookup_field_foreign_table_mismatch'
        );
        expect(errorData?.localization).toEqual({
          i18nKey: 'httpErrors.field.lookupFieldNotBelongToTable',
          context: { lookupFieldId: pointsFieldId, foreignTableId: products.id },
        });

        const fields = await getFields(orders.id);
        expect(fields.find((field) => field.name === 'CrossTableRollup')).toBeUndefined();
      } finally {
        await permanentDeleteTable(baseId, orders.id);
        await permanentDeleteTable(baseId, customers.id);
        await permanentDeleteTable(baseId, products.id);
      }
    });
  });

  it('creates and computes a conditional rollup whose source field belongs to the foreign table', async () => {
    await withForceV2All(async () => {
      const products = await createTable(baseId, {
        name: 'CondRollupHappyPath_Products',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Price', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Name: 'Apple', Price: 10 } },
          { fields: { Name: 'Banana', Price: 20 } },
        ],
      });
      const orders = await createTable(baseId, {
        name: 'CondRollupHappyPath_Orders',
        fields: [{ name: 'OrderNo', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { OrderNo: 'O1' } }],
      });

      const priceFieldId = products.fields.find((field) => field.name === 'Price')!.id;

      try {
        const rollupField = await createField(orders.id, {
          name: 'TotalPrice',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: products.id,
            lookupFieldId: priceFieldId,
            expression: 'sum({values})',
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: priceFieldId, operator: 'isGreater', value: 0 }],
            },
          },
        } as IFieldRo);

        expect(rollupField.type).toBe(FieldType.ConditionalRollup);

        const records = await getRecords(orders.id, { fieldKeyType: FieldKeyType.Id });
        expect(records.records[0].fields[rollupField.id]).toEqual(30);
      } finally {
        await permanentDeleteTable(baseId, orders.id);
        await permanentDeleteTable(baseId, products.id);
      }
    });
  });
});
