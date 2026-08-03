/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILookupOptionsRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createBase,
  createField,
  createTable,
  deleteBase,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Lookup cross base tiering (e2e)', () => {
  let app: INestApplication;
  const hostBaseId = globalThis.testConfig.baseId;
  const spaceId = globalThis.testConfig.spaceId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('one-way link to foreign tiering table with nested lookup', () => {
    let foreignBaseId: string;

    let productsTable: ITableFullVo;
    let productPackagesTable: ITableFullVo;
    let packageTieringTable: ITableFullVo;
    let subscriptionTable: ITableFullVo;

    let productLink: IFieldVo;
    let packageIdLink: IFieldVo;
    let packageTieringProductLookup: IFieldVo;
    let tieringLink: IFieldVo;
    let subscriptionProductLookup: IFieldVo;

    beforeEach(async () => {
      const foreignBase = await createBase({
        spaceId,
        name: 'Lookup Cross Base Tiering - Foreign',
      });
      foreignBaseId = foreignBase.id;

      productsTable = await createTable(foreignBaseId, {
        name: 'Products',
        fields: [{ name: 'Product Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'Product Name': 'Prod-A' } }],
      });

      productPackagesTable = await createTable(foreignBaseId, {
        name: 'Product Packages',
        fields: [{ name: 'Package Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'Package Name': 'Pkg-A' } }],
      });

      productLink = await createField(productPackagesTable.id, {
        name: 'Product',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: productsTable.id,
        },
      } as IFieldRo);

      await updateRecordByApi(
        productPackagesTable.id,
        productPackagesTable.records[0].id,
        productLink.id,
        { id: productsTable.records[0].id }
      );

      packageTieringTable = await createTable(foreignBaseId, {
        name: 'Package Tiering',
        fields: [{ name: 'Tier', type: FieldType.SingleLineText }],
        records: [{ fields: { Tier: 'Tier-1' } }],
      });

      packageIdLink = await createField(packageTieringTable.id, {
        name: 'Package ID',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: productPackagesTable.id,
        },
      } as IFieldRo);

      packageTieringProductLookup = await createField(packageTieringTable.id, {
        name: 'Product (lookup)',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: productPackagesTable.id,
          linkFieldId: packageIdLink.id,
          lookupFieldId: productLink.id,
        } as ILookupOptionsRo,
      } as IFieldRo);

      await updateRecordByApi(
        packageTieringTable.id,
        packageTieringTable.records[0].id,
        packageIdLink.id,
        { id: productPackagesTable.records[0].id }
      );

      subscriptionTable = await createTable(hostBaseId, {
        name: 'Data Subscription',
        fields: [{ name: 'Subscription Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'Subscription Name': 'Sub-1' } }],
      });

      tieringLink = await createField(subscriptionTable.id, {
        name: 'Tiering',
        type: FieldType.Link,
        options: {
          baseId: foreignBaseId,
          relationship: Relationship.ManyOne,
          foreignTableId: packageTieringTable.id,
          isOneWay: true,
        },
      } as IFieldRo);

      await updateRecordByApi(
        subscriptionTable.id,
        subscriptionTable.records[0].id,
        tieringLink.id,
        { id: packageTieringTable.records[0].id }
      );

      subscriptionProductLookup = await createField(subscriptionTable.id, {
        name: 'Lookup Product',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: packageTieringTable.id,
          linkFieldId: tieringLink.id,
          lookupFieldId: packageTieringProductLookup.id,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterEach(async () => {
      if (subscriptionTable?.id) {
        await permanentDeleteTable(hostBaseId, subscriptionTable.id);
      }

      if (packageTieringTable?.id) {
        await permanentDeleteTable(foreignBaseId, packageTieringTable.id);
      }

      if (productPackagesTable?.id) {
        await permanentDeleteTable(foreignBaseId, productPackagesTable.id);
      }

      if (productsTable?.id) {
        await permanentDeleteTable(foreignBaseId, productsTable.id);
      }

      if (foreignBaseId) {
        await deleteBase(foreignBaseId);
      }
    });

    it('creates lookup on nested lookup-of-link chain across bases', async () => {
      const records = await getRecords(subscriptionTable.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [tieringLink.id, subscriptionProductLookup.id],
      });

      expect(records.records).toHaveLength(1);
      const record = records.records[0];

      const lookupValue = record.fields[subscriptionProductLookup.id] as
        | { id: string; title?: string }
        | Array<{ id: string; title?: string }>;

      expect(lookupValue).toBeDefined();

      const normalizedValues = Array.isArray(lookupValue) ? lookupValue : [lookupValue];
      const normalizedIds = normalizedValues.map((item) => item.id);
      const normalizedTitles = normalizedValues.map((item) => item.title);

      expect(normalizedIds).toContain(productsTable.records[0].id);
      expect(normalizedTitles).toContain('Prod-A');
    });
  });
});
