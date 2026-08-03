/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILookupOptionsRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Lookup on lookup-to-link chain (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('lookup targeting a lookup link field', () => {
    beforeAll(() => {
      process.env.DEBUG_LOOKUP_SQL = '1';
    });

    let productTable: ITableFullVo;
    let packageTable: ITableFullVo;
    let tieringTable: ITableFullVo;
    let billingTable: ITableFullVo;

    let packageToProductLink: IFieldVo;
    let tieringToPackageLink: IFieldVo;
    let tieringProductLookup: IFieldVo;
    let billingToTieringLink: IFieldVo;
    let billingProductLookup: IFieldVo;

    beforeEach(async () => {
      // Product table (final target)
      productTable = await createTable(baseId, {
        name: 'Products',
        fields: [
          {
            name: 'Product Name',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { 'Product Name': 'Prod-A' } }],
      });

      // Package table links to product
      packageTable = await createTable(baseId, {
        name: 'Packages',
        fields: [
          {
            name: 'Package Name',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { 'Package Name': 'Pkg-1' } }],
      });

      packageToProductLink = await createField(packageTable.id, {
        name: 'Product Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: productTable.id,
        },
      } as IFieldRo);

      await updateRecordByApi(
        packageTable.id,
        packageTable.records[0].id,
        packageToProductLink.id,
        {
          id: productTable.records[0].id,
        }
      );

      // Tiering table links to package and looks up the package's product link
      tieringTable = await createTable(baseId, {
        name: 'Tiering',
        fields: [
          {
            name: 'Tiering Label',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { 'Tiering Label': 'T1' } }],
      });

      tieringToPackageLink = await createField(tieringTable.id, {
        name: 'Package Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: packageTable.id,
        },
      } as IFieldRo);

      tieringProductLookup = await createField(tieringTable.id, {
        name: 'Product (lookup)',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: packageTable.id,
          linkFieldId: tieringToPackageLink.id,
          lookupFieldId: packageToProductLink.id,
        } as ILookupOptionsRo,
      } as IFieldRo);

      await updateRecordByApi(
        tieringTable.id,
        tieringTable.records[0].id,
        tieringToPackageLink.id,
        {
          id: packageTable.records[0].id,
        }
      );

      // Billing table links to tiering and looks up tiering's product lookup
      billingTable = await createTable(baseId, {
        name: 'Billing',
        fields: [
          {
            name: 'Billing Label',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { 'Billing Label': 'B1' } }],
      });

      billingToTieringLink = await createField(billingTable.id, {
        name: 'Tiering Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: tieringTable.id,
        },
      } as IFieldRo);

      billingProductLookup = await createField(billingTable.id, {
        name: 'Product via Tiering',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tieringTable.id,
          linkFieldId: billingToTieringLink.id,
          lookupFieldId: tieringProductLookup.id,
        } as ILookupOptionsRo,
      } as IFieldRo);

      await updateRecordByApi(
        billingTable.id,
        billingTable.records[0].id,
        billingToTieringLink.id,
        { id: tieringTable.records[0].id }
      );
    });

    afterEach(async () => {
      if (billingTable?.id) await permanentDeleteTable(baseId, billingTable.id);
      if (tieringTable?.id) await permanentDeleteTable(baseId, tieringTable.id);
      if (packageTable?.id) await permanentDeleteTable(baseId, packageTable.id);
      if (productTable?.id) await permanentDeleteTable(baseId, productTable.id);
    });

    it('returns values when lookup targets a lookup-to-link field', async () => {
      const tieringRecords = await getRecords(tieringTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      expect(tieringRecords.records).toHaveLength(1);
      const tieringRecord = tieringRecords.records[0];
      const tieringLookupValue = tieringRecord.fields[tieringProductLookup.id] as
        | { id: string; title?: string }
        | Array<{ id: string; title?: string }>;

      expect(tieringLookupValue).toBeDefined();

      const tieringNormalizedIds = Array.isArray(tieringLookupValue)
        ? tieringLookupValue.map((item) => item.id)
        : [tieringLookupValue.id];

      expect(tieringNormalizedIds).toContain(productTable.records[0].id);

      const billingLabelField = billingTable.fields.find((f) => f.name === 'Billing Label');
      const billingRecords = await getRecords(billingTable.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [
          billingProductLookup.id,
          billingToTieringLink.id,
          billingLabelField?.id ?? '',
        ].filter(Boolean),
      });

      expect(billingRecords.records).toHaveLength(1);
      const billingRecord = billingRecords.records[0];
      const lookupValue = billingRecord.fields[billingProductLookup.id] as
        | { id: string; title?: string }
        | Array<{ id: string; title?: string }>;

      // eslint-disable-next-line no-console
      console.log('billing fields snapshot', billingRecord.fields);

      expect(lookupValue).toBeDefined();

      const normalizedIds = Array.isArray(lookupValue)
        ? lookupValue.map((item) => item.id)
        : [lookupValue.id];

      expect(normalizedIds).toContain(productTable.records[0].id);

      const normalizedTitles = Array.isArray(lookupValue)
        ? lookupValue.map((item) => item.title)
        : [lookupValue.title];

      expect(normalizedTitles).toContain('Prod-A');
    });
  });
});
