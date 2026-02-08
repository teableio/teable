/* eslint-disable @typescript-eslint/naming-convention */
import {
  createBaseOkResponseSchema,
  createFieldOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe.skip('v2 http cross-base lookup (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createBase = async (name: string) => {
    const response = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, spaceId: 'space_test' }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateBase failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createBaseOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create base: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.baseId;
  };

  const createTableWithBaseId = async (targetBaseId: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, baseId: targetBaseId }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateTable failed: ${JSON.stringify(rawBody)}`);
    }
    return rawBody.data.table;
  };

  const createFieldWithBaseId = async (
    targetBaseId: string,
    tableId: string,
    field: Record<string, unknown>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: targetBaseId, tableId, field }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateField failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create field: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.field;
  };

  const updateRecordWithBaseId = async (
    targetBaseId: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: targetBaseId, tableId, recordId, fields }),
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`UpdateRecord failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to update record: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.record;
  };

  const listRecordsWithBaseId = async (targetBaseId: string, tableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/listRecords?baseId=${targetBaseId}&tableId=${tableId}`,
      { method: 'GET' }
    );
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to list records: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('one-way cross-base link', () => {
    it('should create one-way link from host base to foreign base', async () => {
      // Create foreign base
      const foreignBaseId = await createBase('ForeignBase_OneWay');

      // Create foreign table with Product field
      const productNameFieldId = createFieldId();

      const foreignTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Products',
        fields: [{ type: 'singleLineText', id: productNameFieldId, name: 'ProductName' }],
        records: [{ fields: { [productNameFieldId]: 'Product-A' } }],
      });

      // Create host table with one-way link
      const linkFieldId = createFieldId();

      const hostTable = await createTableWithBaseId(ctx.baseId, {
        name: 'Orders',
        fields: [
          {
            type: 'link',
            id: linkFieldId,
            name: 'Product',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              isOneWay: true,
            },
          },
        ],
        records: [{ fields: {} }],
      });

      // Link the record
      const hostRecords = await listRecordsWithBaseId(ctx.baseId, hostTable.id);
      const hostRecord = hostRecords[0];

      const foreignRecords = await listRecordsWithBaseId(foreignBaseId, foreignTable.id);
      const foreignRecord = foreignRecords[0];

      await updateRecordWithBaseId(ctx.baseId, hostTable.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });

      await ctx.testContainer.processOutbox();

      // Verify link is established
      const updatedHostRecords = await listRecordsWithBaseId(ctx.baseId, hostTable.id);
      const updatedHostRecord = updatedHostRecords[0];

      expect(updatedHostRecord.fields[linkFieldId]).toEqual([{ id: foreignRecord.id }]);
    });
  });

  describe('simple cross-base lookup', () => {
    it('should lookup through cross-base one-way link', async () => {
      // Create foreign base
      const foreignBaseId = await createBase('ForeignBase_SimpleLookup');

      // Create foreign table
      const productNameFieldId = createFieldId();
      const productPriceFieldId = createFieldId();

      const foreignTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Products',
        fields: [
          { type: 'singleLineText', id: productNameFieldId, name: 'ProductName' },
          { type: 'number', id: productPriceFieldId, name: 'Price' },
        ],
        records: [{ fields: { [productNameFieldId]: 'Widget', [productPriceFieldId]: 99.99 } }],
      });

      // Create host table with link and lookup
      const linkFieldId = createFieldId();
      const lookupFieldId = createFieldId();

      const hostTable = await createTableWithBaseId(ctx.baseId, {
        name: 'Orders',
        fields: [
          {
            type: 'link',
            id: linkFieldId,
            name: 'Product',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              isOneWay: true,
            },
          },
        ],
        records: [{ fields: {} }],
      });

      // Create lookup field for product name
      await createFieldWithBaseId(ctx.baseId, hostTable.id, {
        type: 'singleLineText',
        id: lookupFieldId,
        name: 'Product Name (Lookup)',
        isLookup: true,
        lookupOptions: {
          linkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: productNameFieldId,
        },
      });

      // Link the record
      const hostRecords = await listRecordsWithBaseId(ctx.baseId, hostTable.id);
      const hostRecord = hostRecords[0];

      const foreignRecords = await listRecordsWithBaseId(foreignBaseId, foreignTable.id);
      const foreignRecord = foreignRecords[0];

      await updateRecordWithBaseId(ctx.baseId, hostTable.id, hostRecord.id, {
        [linkFieldId]: { id: foreignRecord.id },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify lookup resolves correctly
      const updatedHostRecords = await listRecordsWithBaseId(ctx.baseId, hostTable.id);
      const updatedHostRecord = updatedHostRecords[0];

      expect(updatedHostRecord.fields[lookupFieldId]).toEqual(['Widget']);
    });
  });

  describe('nested cross-base lookup', () => {
    it('should support lookup of lookup across base boundaries', async () => {
      // Create foreign base
      const foreignBaseId = await createBase('ForeignBase_NestedLookup');

      // Create first table: Products
      const productNameFieldId = createFieldId();

      const productsTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Products',
        fields: [{ type: 'singleLineText', id: productNameFieldId, name: 'ProductName' }],
        records: [{ fields: { [productNameFieldId]: 'Premium Widget' } }],
      });

      // Create second table: Packages (links to Products)
      const packageLinkFieldId = createFieldId();
      const packageLookupFieldId = createFieldId();

      const packagesTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Packages',
        fields: [
          {
            type: 'link',
            id: packageLinkFieldId,
            name: 'Product',
            options: {
              relationship: 'manyOne',
              foreignTableId: productsTable.id,
              isOneWay: false,
            },
          },
        ],
        records: [{ fields: {} }],
      });

      // Add lookup field to Packages
      await createFieldWithBaseId(foreignBaseId, packagesTable.id, {
        type: 'singleLineText',
        id: packageLookupFieldId,
        name: 'Product Name (Lookup)',
        isLookup: true,
        lookupOptions: {
          linkFieldId: packageLinkFieldId,
          foreignTableId: productsTable.id,
          lookupFieldId: productNameFieldId,
        },
      });

      // Link package to product
      const productRecords = await listRecordsWithBaseId(foreignBaseId, productsTable.id);
      const productRecord = productRecords[0];

      const packageRecords = await listRecordsWithBaseId(foreignBaseId, packagesTable.id);
      const packageRecord = packageRecords[0];

      await updateRecordWithBaseId(foreignBaseId, packagesTable.id, packageRecord.id, {
        [packageLinkFieldId]: { id: productRecord.id },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Create third table: Tiers (links to Packages)
      const tierLinkFieldId = createFieldId();
      const tierLookupFieldId = createFieldId();

      const tiersTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Tiers',
        fields: [
          {
            type: 'link',
            id: tierLinkFieldId,
            name: 'Package',
            options: {
              relationship: 'manyOne',
              foreignTableId: packagesTable.id,
              isOneWay: false,
            },
          },
        ],
        records: [{ fields: {} }],
      });

      // Add nested lookup to Tiers (lookup of lookup)
      await createFieldWithBaseId(foreignBaseId, tiersTable.id, {
        type: 'singleLineText',
        id: tierLookupFieldId,
        name: 'Product (Nested Lookup)',
        isLookup: true,
        lookupOptions: {
          linkFieldId: tierLinkFieldId,
          foreignTableId: packagesTable.id,
          lookupFieldId: packageLookupFieldId,
        },
      });

      // Link tier to package
      const tierRecords = await listRecordsWithBaseId(foreignBaseId, tiersTable.id);
      const tierRecord = tierRecords[0];

      await updateRecordWithBaseId(foreignBaseId, tiersTable.id, tierRecord.id, {
        [tierLinkFieldId]: { id: packageRecord.id },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify nested lookup resolves
      const updatedTierRecords = await listRecordsWithBaseId(foreignBaseId, tiersTable.id);
      const updatedTierRecord = updatedTierRecords[0];

      expect(updatedTierRecord.fields[tierLookupFieldId]).toEqual(['Premium Widget']);

      // Now create host table in main base that links to Tiers
      const hostLinkFieldId = createFieldId();
      const hostLookupFieldId = createFieldId();

      const hostTable = await createTableWithBaseId(ctx.baseId, {
        name: 'Subscriptions',
        fields: [
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Tier',
            options: {
              relationship: 'manyOne',
              foreignTableId: tiersTable.id,
              isOneWay: true,
            },
          },
        ],
        records: [{ fields: {} }],
      });

      // Add cross-base nested lookup to host
      await createFieldWithBaseId(ctx.baseId, hostTable.id, {
        type: 'singleLineText',
        id: hostLookupFieldId,
        name: 'Product (Cross-Base Nested Lookup)',
        isLookup: true,
        lookupOptions: {
          linkFieldId: hostLinkFieldId,
          foreignTableId: tiersTable.id,
          lookupFieldId: tierLookupFieldId,
        },
      });

      // Link host to tier
      const hostRecords = await listRecordsWithBaseId(ctx.baseId, hostTable.id);
      const hostRecord = hostRecords[0];

      await updateRecordWithBaseId(ctx.baseId, hostTable.id, hostRecord.id, {
        [hostLinkFieldId]: { id: tierRecord.id },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify cross-base nested lookup resolves
      const updatedHostRecords = await listRecordsWithBaseId(ctx.baseId, hostTable.id);
      const updatedHostRecord = updatedHostRecords[0];

      expect(updatedHostRecord.fields[hostLookupFieldId]).toEqual(['Premium Widget']);
    });
  });

  describe('cross-base lookup of link chains', () => {
    it('creates lookup on nested lookup-of-link chain across bases', async () => {
      const foreignBaseId = await createBase('ForeignBase_Tiering_LinkLookup');

      const productNameFieldId = createFieldId();
      const productsTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Products',
        fields: [{ type: 'singleLineText', id: productNameFieldId, name: 'Product Name' }],
        records: [{ fields: { [productNameFieldId]: 'Prod-A' } }],
      });

      const packageNameFieldId = createFieldId();
      const productLinkFieldId = createFieldId();
      const productPackagesTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Product Packages',
        fields: [
          { type: 'singleLineText', id: packageNameFieldId, name: 'Package Name' },
          {
            type: 'link',
            id: productLinkFieldId,
            name: 'Product',
            options: {
              relationship: 'manyOne',
              foreignTableId: productsTable.id,
              lookupFieldId: productNameFieldId,
            },
          },
        ],
        records: [{ fields: { [packageNameFieldId]: 'Pkg-A' } }],
      });

      const productRecords = await listRecordsWithBaseId(foreignBaseId, productsTable.id);
      const packageRecords = await listRecordsWithBaseId(foreignBaseId, productPackagesTable.id);

      await updateRecordWithBaseId(foreignBaseId, productPackagesTable.id, packageRecords[0].id, {
        [productLinkFieldId]: { id: productRecords[0].id },
      });

      const tierFieldId = createFieldId();
      const packageIdLinkFieldId = createFieldId();
      const packageTieringProductLookupId = createFieldId();

      const packageTieringTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Package Tiering',
        fields: [
          { type: 'singleLineText', id: tierFieldId, name: 'Tier' },
          {
            type: 'link',
            id: packageIdLinkFieldId,
            name: 'Package ID',
            options: {
              relationship: 'manyOne',
              foreignTableId: productPackagesTable.id,
              lookupFieldId: packageNameFieldId,
            },
          },
        ],
        records: [{ fields: { [tierFieldId]: 'Tier-1' } }],
      });

      await createFieldWithBaseId(foreignBaseId, packageTieringTable.id, {
        type: 'link',
        id: packageTieringProductLookupId,
        name: 'Product (lookup)',
        isLookup: true,
        lookupOptions: {
          linkFieldId: packageIdLinkFieldId,
          foreignTableId: productPackagesTable.id,
          lookupFieldId: productLinkFieldId,
        },
      });

      const tieringRecords = await listRecordsWithBaseId(foreignBaseId, packageTieringTable.id);
      await updateRecordWithBaseId(foreignBaseId, packageTieringTable.id, tieringRecords[0].id, {
        [packageIdLinkFieldId]: { id: packageRecords[0].id },
      });

      const subscriptionNameFieldId = createFieldId();
      const tieringLinkFieldId = createFieldId();
      const subscriptionProductLookupId = createFieldId();

      const subscriptionTable = await createTableWithBaseId(ctx.baseId, {
        name: 'Data Subscription',
        fields: [
          { type: 'singleLineText', id: subscriptionNameFieldId, name: 'Subscription Name' },
          {
            type: 'link',
            id: tieringLinkFieldId,
            name: 'Tiering',
            options: {
              baseId: foreignBaseId,
              relationship: 'manyOne',
              foreignTableId: packageTieringTable.id,
              lookupFieldId: tierFieldId,
              isOneWay: true,
            },
          },
        ],
        records: [{ fields: { [subscriptionNameFieldId]: 'Sub-1' } }],
      });

      await createFieldWithBaseId(ctx.baseId, subscriptionTable.id, {
        type: 'link',
        id: subscriptionProductLookupId,
        name: 'Lookup Product',
        isLookup: true,
        lookupOptions: {
          linkFieldId: tieringLinkFieldId,
          foreignTableId: packageTieringTable.id,
          lookupFieldId: packageTieringProductLookupId,
        },
      });

      const subscriptionRecords = await listRecordsWithBaseId(ctx.baseId, subscriptionTable.id);
      await updateRecordWithBaseId(ctx.baseId, subscriptionTable.id, subscriptionRecords[0].id, {
        [tieringLinkFieldId]: { id: tieringRecords[0].id },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const updatedSubscriptionRecords = await listRecordsWithBaseId(
        ctx.baseId,
        subscriptionTable.id
      );
      const lookupValue = updatedSubscriptionRecords[0].fields[subscriptionProductLookupId] as
        | { id: string; title?: string }
        | Array<{ id: string; title?: string }>;

      const normalized = Array.isArray(lookupValue) ? lookupValue : [lookupValue];
      const lookupIds = normalized.map((entry) => entry.id);
      const lookupTitles = normalized.map((entry) => entry.title);

      expect(lookupIds).toContain(productRecords[0].id);
      expect(lookupTitles).toContain('Prod-A');
    });
  });

  describe('conditional cross-base lookup', () => {
    it('should support conditional lookup with field references across bases', async () => {
      // Create foreign base
      const foreignBaseId = await createBase('ForeignBase_ConditionalLookup');

      // Create foreign table with filterable data
      const itemNameFieldId = createFieldId();
      const itemStatusFieldId = createFieldId();

      const foreignTable = await createTableWithBaseId(foreignBaseId, {
        name: 'Items',
        fields: [
          { type: 'singleLineText', id: itemNameFieldId, name: 'ItemName' },
          { type: 'singleLineText', id: itemStatusFieldId, name: 'Status' },
        ],
        records: [
          { fields: { [itemNameFieldId]: 'Item-A', [itemStatusFieldId]: 'Active' } },
          { fields: { [itemNameFieldId]: 'Item-B', [itemStatusFieldId]: 'Inactive' } },
          { fields: { [itemNameFieldId]: 'Item-C', [itemStatusFieldId]: 'Active' } },
        ],
      });

      // Create host table with filter field
      const statusFilterFieldId = createFieldId();
      const conditionalLookupFieldId = createFieldId();

      const hostTable = await createTableWithBaseId(ctx.baseId, {
        name: 'Dashboard',
        fields: [{ type: 'singleLineText', id: statusFilterFieldId, name: 'StatusFilter' }],
        records: [{ fields: { [statusFilterFieldId]: 'Active' } }],
      });

      // Create conditional lookup across bases
      await createFieldWithBaseId(ctx.baseId, hostTable.id, {
        type: 'conditionalLookup',
        id: conditionalLookupFieldId,
        name: 'Filtered Items',
        options: {
          foreignTableId: foreignTable.id,
          lookupFieldId: itemNameFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: itemStatusFieldId,
                  operator: 'is',
                  value: statusFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify conditional lookup across bases
      const hostRecords = await listRecordsWithBaseId(ctx.baseId, hostTable.id);
      const hostRecord = hostRecords[0];

      expect(hostRecord.fields[conditionalLookupFieldId]).toEqual(['Item-A', 'Item-C']);
    });
  });
});
