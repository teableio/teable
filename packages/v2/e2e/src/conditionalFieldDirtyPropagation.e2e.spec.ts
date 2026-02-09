/* eslint-disable @typescript-eslint/naming-convention */
/**
 * E2E tests for conditionalLookup/conditionalRollup dirty propagation optimization.
 *
 * These tests verify that when source records change:
 * - Only source records matching the filter condition trigger target updates
 * - Source records NOT matching the filter should NOT trigger unnecessary updates
 * - Filter field changes always trigger updates (conservative fallback)
 *
 * The optimization uses 'conditionalFiltered' propagation mode instead of 'allTargetRecords'
 * when the changed fields don't overlap with filter-referenced fields.
 */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  deleteRecordsOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 conditionalField dirty propagation (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }
    return parsed.data.data.table;
  };

  const createField = async (
    tableId: string,
    field: Record<string, unknown>
  ): Promise<{ status: number; rawBody: unknown }> => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: ctx.baseId, tableId, field }),
    });
    const rawBody = await response.json();
    return { status: response.status, rawBody };
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create record response');
    }
    return parsed.data.data.record;
  };

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse update record response');
    }
    return parsed.data.data.record;
  };

  const deleteRecords = async (
    tableId: string,
    recordIds: string[]
  ): Promise<{ status: number; rawBody: unknown }> => {
    const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, recordIds }),
    });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const rawBody = await response.json();
      return { status: response.status, rawBody };
    }
    const text = await response.text();
    return { status: response.status, rawBody: { error: text } };
  };

  const listRecords = async (tableId: string) => {
    const params = new URLSearchParams({ tableId });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
  };

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await ctx.testContainer.processOutbox();
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('conditionalRollup dirty propagation', () => {
    /**
     * Setup:
     * - Products table with Category (singleLineText: 'Electronics', 'Books') and Price (number)
     * - Reports table with conditionalRollup: SUM(Products.Price) WHERE Category = 'Electronics'
     *
     * The filter references Category field, so:
     * - Updating Price of Electronics product → should update Reports
     * - Updating Price of Books product → should NOT update Reports (optimization)
     * - Updating Category field → should always update Reports (conservative)
     *
     * Note: Using singleLineText for Category to match the pattern in computed.e2e.spec.ts
     */
    let productsTableId: string;
    let productsPrimaryFieldId: string;
    let productsCategoryFieldId: string;
    let productsPriceFieldId: string;

    let reportsTableId: string;
    let reportsPrimaryFieldId: string;
    let reportsConditionalRollupFieldId: string;

    beforeAll(async () => {
      // Create Products table (use singleLineText for Category like computed.e2e.spec.ts)
      productsPrimaryFieldId = createFieldId();
      productsCategoryFieldId = createFieldId();
      productsPriceFieldId = createFieldId();

      const productsTable = await createTable({
        baseId: ctx.baseId,
        name: 'DirtyProp Products',
        fields: [
          { type: 'singleLineText', id: productsPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: productsCategoryFieldId, name: 'Category' },
          { type: 'number', id: productsPriceFieldId, name: 'Price' },
        ],
        views: [{ type: 'grid' }],
      });
      productsTableId = productsTable.id;

      // Create Reports table with conditionalRollup
      reportsPrimaryFieldId = createFieldId();
      reportsConditionalRollupFieldId = createFieldId();

      const reportsTable = await createTable({
        baseId: ctx.baseId,
        name: 'DirtyProp Reports',
        fields: [
          { type: 'singleLineText', id: reportsPrimaryFieldId, name: 'Report', isPrimary: true },
        ],
        views: [{ type: 'grid' }],
      });
      reportsTableId = reportsTable.id;

      // Add conditionalRollup field (filter by Category = 'Electronics')
      const { status, rawBody } = await createField(reportsTableId, {
        type: 'conditionalRollup',
        id: reportsConditionalRollupFieldId,
        name: 'Electronics Total',
        options: {
          expression: 'sum({values})',
        },
        config: {
          foreignTableId: productsTableId,
          lookupFieldId: productsPriceFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: productsCategoryFieldId,
                  operator: 'is',
                  value: 'Electronics',
                },
              ],
            },
          },
        },
      });

      if (status !== 200) {
        console.error('CreateField failed:', JSON.stringify(rawBody, null, 2));
        throw new Error(`Failed to create conditionalRollup field: ${JSON.stringify(rawBody)}`);
      }
    });

    it('updates rollup when Electronics product price changes', async () => {
      // Create Electronics product
      const electronics = await createRecord(productsTableId, {
        [productsPrimaryFieldId]: 'Laptop',
        [productsCategoryFieldId]: 'Electronics',
        [productsPriceFieldId]: 1000,
      });

      // Create report
      const report = await createRecord(reportsTableId, {
        [reportsPrimaryFieldId]: 'Q1 Report',
      });
      await processOutbox();

      // Check initial rollup value (may be number or string)
      let records = await listRecords(reportsTableId);
      let stored = records.find((r) => r.id === report.id);
      expect(Number(stored?.fields[reportsConditionalRollupFieldId])).toBe(1000);

      // Update Electronics product price
      await updateRecord(productsTableId, electronics.id, {
        [productsPriceFieldId]: 1500,
      });
      await processOutbox();

      // Rollup should update
      records = await listRecords(reportsTableId);
      stored = records.find((r) => r.id === report.id);
      expect(Number(stored?.fields[reportsConditionalRollupFieldId])).toBe(1500);
    });

    it('does NOT update rollup when Books product price changes', async () => {
      // Create Books product (does not match filter)
      const books = await createRecord(productsTableId, {
        [productsPrimaryFieldId]: 'Novel',
        [productsCategoryFieldId]: 'Books',
        [productsPriceFieldId]: 20,
      });

      // Create report
      const report = await createRecord(reportsTableId, {
        [reportsPrimaryFieldId]: 'Q2 Report',
      });
      await processOutbox();

      // Get initial rollup value
      let records = await listRecords(reportsTableId);
      let stored = records.find((r) => r.id === report.id);
      const initialValue = stored?.fields[reportsConditionalRollupFieldId];

      // Update Books product price (should NOT trigger rollup update due to optimization)
      await updateRecord(productsTableId, books.id, {
        [productsPriceFieldId]: 25,
      });
      await processOutbox();

      // Rollup should remain unchanged
      records = await listRecords(reportsTableId);
      stored = records.find((r) => r.id === report.id);
      expect(stored?.fields[reportsConditionalRollupFieldId]).toBe(initialValue);
    });

    it('updates rollup when product Category changes from Electronics to Books', async () => {
      // Create Electronics product
      const product = await createRecord(productsTableId, {
        [productsPrimaryFieldId]: 'Tablet',
        [productsCategoryFieldId]: 'Electronics',
        [productsPriceFieldId]: 500,
      });

      // Create report
      const report = await createRecord(reportsTableId, {
        [reportsPrimaryFieldId]: 'Q3 Report',
      });
      await processOutbox();

      // Check initial rollup includes the tablet
      let records = await listRecords(reportsTableId);
      let stored = records.find((r) => r.id === report.id);
      const initialValue = parseFloat(
        String(stored?.fields[reportsConditionalRollupFieldId] ?? '0')
      );
      expect(initialValue).toBeGreaterThanOrEqual(500);

      // Change category from Electronics to Books (record leaves the result set)
      await updateRecord(productsTableId, product.id, {
        [productsCategoryFieldId]: 'Books',
      });
      await processOutbox();

      // Rollup should decrease by 500
      records = await listRecords(reportsTableId);
      stored = records.find((r) => r.id === report.id);
      expect(Number(stored?.fields[reportsConditionalRollupFieldId])).toBe(initialValue - 500);
    });

    it('updates rollup when product Category changes from Books to Electronics', async () => {
      // Create Books product
      const product = await createRecord(productsTableId, {
        [productsPrimaryFieldId]: 'Headphones',
        [productsCategoryFieldId]: 'Books',
        [productsPriceFieldId]: 200,
      });

      // Create report
      const report = await createRecord(reportsTableId, {
        [reportsPrimaryFieldId]: 'Q4 Report',
      });
      await processOutbox();

      // Get initial rollup value (should not include the headphones)
      let records = await listRecords(reportsTableId);
      let stored = records.find((r) => r.id === report.id);
      const initialValue = parseFloat(
        String(stored?.fields[reportsConditionalRollupFieldId] ?? '0')
      );

      // Change category from Books to Electronics (record joins the result set)
      await updateRecord(productsTableId, product.id, {
        [productsCategoryFieldId]: 'Electronics',
      });
      await processOutbox();

      // Rollup should increase by 200
      records = await listRecords(reportsTableId);
      stored = records.find((r) => r.id === report.id);
      expect(Number(stored?.fields[reportsConditionalRollupFieldId])).toBe(initialValue + 200);
    });

    it('updates rollup when new Electronics product is inserted', async () => {
      // Create report first
      const report = await createRecord(reportsTableId, {
        [reportsPrimaryFieldId]: 'Insert Test Report',
      });
      await processOutbox();

      // Get initial rollup value
      let records = await listRecords(reportsTableId);
      let stored = records.find((r) => r.id === report.id);
      const initialValue = parseFloat(
        String(stored?.fields[reportsConditionalRollupFieldId] ?? '0')
      );

      // Insert new Electronics product
      await createRecord(productsTableId, {
        [productsPrimaryFieldId]: 'New Electronics',
        [productsCategoryFieldId]: 'Electronics',
        [productsPriceFieldId]: 300,
      });
      await processOutbox();

      // Rollup should increase
      records = await listRecords(reportsTableId);
      stored = records.find((r) => r.id === report.id);
      expect(Number(stored?.fields[reportsConditionalRollupFieldId])).toBe(initialValue + 300);
    });

    it('does NOT update rollup when new Books product is inserted', async () => {
      // Create report first
      const report = await createRecord(reportsTableId, {
        [reportsPrimaryFieldId]: 'Insert Books Test Report',
      });
      await processOutbox();

      // Get initial rollup value
      let records = await listRecords(reportsTableId);
      let stored = records.find((r) => r.id === report.id);
      const initialValue = stored?.fields[reportsConditionalRollupFieldId];

      // Insert new Books product (should not trigger rollup update)
      await createRecord(productsTableId, {
        [productsPrimaryFieldId]: 'New Book',
        [productsCategoryFieldId]: 'Books',
        [productsPriceFieldId]: 15,
      });
      await processOutbox();

      // Rollup should remain unchanged
      records = await listRecords(reportsTableId);
      stored = records.find((r) => r.id === report.id);
      expect(stored?.fields[reportsConditionalRollupFieldId]).toBe(initialValue);
    });
  });

  describe('conditionalLookup dirty propagation', () => {
    /**
     * Setup:
     * - Items table with Status (singleLineText: 'Active', 'Archived') and Label (text)
     * - Dashboard table with conditionalLookup: Items.Label WHERE Status = 'Active'
     *
     * Note: Using singleLineText for Status to match the pattern in computed.e2e.spec.ts
     */
    let itemsTableId: string;
    let itemsPrimaryFieldId: string;
    let itemsStatusFieldId: string;
    let itemsLabelFieldId: string;

    let dashboardTableId: string;
    let dashboardPrimaryFieldId: string;
    let dashboardConditionalLookupFieldId: string;

    beforeAll(async () => {
      // Create Items table (use singleLineText for Status)
      itemsPrimaryFieldId = createFieldId();
      itemsStatusFieldId = createFieldId();
      itemsLabelFieldId = createFieldId();

      const itemsTable = await createTable({
        baseId: ctx.baseId,
        name: 'DirtyProp Items',
        fields: [
          { type: 'singleLineText', id: itemsPrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: itemsStatusFieldId, name: 'Status' },
          { type: 'singleLineText', id: itemsLabelFieldId, name: 'Label' },
        ],
        views: [{ type: 'grid' }],
      });
      itemsTableId = itemsTable.id;

      // Create Dashboard table
      dashboardPrimaryFieldId = createFieldId();
      dashboardConditionalLookupFieldId = createFieldId();

      const dashboardTable = await createTable({
        baseId: ctx.baseId,
        name: 'DirtyProp Dashboard',
        fields: [
          {
            type: 'singleLineText',
            id: dashboardPrimaryFieldId,
            name: 'Dashboard',
            isPrimary: true,
          },
        ],
        views: [{ type: 'grid' }],
      });
      dashboardTableId = dashboardTable.id;

      // Add conditionalLookup field (filter by Status = 'Active')
      const { status, rawBody } = await createField(dashboardTableId, {
        type: 'conditionalLookup',
        id: dashboardConditionalLookupFieldId,
        name: 'Active Labels',
        options: {
          foreignTableId: itemsTableId,
          lookupFieldId: itemsLabelFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: itemsStatusFieldId,
                  operator: 'is',
                  value: 'Active',
                },
              ],
            },
          },
        },
      });

      if (status !== 200) {
        console.error('CreateField failed:', JSON.stringify(rawBody, null, 2));
        throw new Error(`Failed to create conditionalLookup field: ${JSON.stringify(rawBody)}`);
      }
    });

    it('updates lookup when Active item label changes', async () => {
      // Create Active item
      const item = await createRecord(itemsTableId, {
        [itemsPrimaryFieldId]: 'Item 1',
        [itemsStatusFieldId]: 'Active',
        [itemsLabelFieldId]: 'Original Label',
      });

      // Create dashboard
      const dashboard = await createRecord(dashboardTableId, {
        [dashboardPrimaryFieldId]: 'Main Dashboard',
      });
      await processOutbox();

      // Check initial lookup value
      let records = await listRecords(dashboardTableId);
      let stored = records.find((r) => r.id === dashboard.id);
      const initialLookup = stored?.fields[dashboardConditionalLookupFieldId];
      expect(initialLookup).toContain('Original Label');

      // Update Active item's label
      await updateRecord(itemsTableId, item.id, {
        [itemsLabelFieldId]: 'Updated Label',
      });
      await processOutbox();

      // Lookup should update
      records = await listRecords(dashboardTableId);
      stored = records.find((r) => r.id === dashboard.id);
      expect(stored?.fields[dashboardConditionalLookupFieldId]).toContain('Updated Label');
    });

    it('does NOT update lookup when Archived item label changes', async () => {
      // Create Archived item (does not match filter)
      const item = await createRecord(itemsTableId, {
        [itemsPrimaryFieldId]: 'Archived Item',
        [itemsStatusFieldId]: 'Archived',
        [itemsLabelFieldId]: 'Archived Label',
      });

      // Create dashboard
      const dashboard = await createRecord(dashboardTableId, {
        [dashboardPrimaryFieldId]: 'Archive Test Dashboard',
      });
      await processOutbox();

      // Get initial lookup value (should not contain archived item)
      let records = await listRecords(dashboardTableId);
      let stored = records.find((r) => r.id === dashboard.id);
      const initialLookup = stored?.fields[dashboardConditionalLookupFieldId];

      // Update Archived item's label (should NOT trigger lookup update due to optimization)
      await updateRecord(itemsTableId, item.id, {
        [itemsLabelFieldId]: 'Changed Archived Label',
      });
      await processOutbox();

      // Lookup should remain unchanged
      records = await listRecords(dashboardTableId);
      stored = records.find((r) => r.id === dashboard.id);
      expect(stored?.fields[dashboardConditionalLookupFieldId]).toStrictEqual(initialLookup);
    });

    it('updates lookup when item Status changes from Active to Archived', async () => {
      // Create Active item
      const item = await createRecord(itemsTableId, {
        [itemsPrimaryFieldId]: 'Status Change Item 1',
        [itemsStatusFieldId]: 'Active',
        [itemsLabelFieldId]: 'Will Be Archived',
      });

      // Create dashboard
      const dashboard = await createRecord(dashboardTableId, {
        [dashboardPrimaryFieldId]: 'Status Change Dashboard 1',
      });
      await processOutbox();

      // Check initial lookup includes the item
      let records = await listRecords(dashboardTableId);
      let stored = records.find((r) => r.id === dashboard.id);
      expect(stored?.fields[dashboardConditionalLookupFieldId]).toContain('Will Be Archived');

      // Change status from Active to Archived (record leaves the result set)
      await updateRecord(itemsTableId, item.id, {
        [itemsStatusFieldId]: 'Archived',
      });
      await processOutbox();

      // Lookup should no longer contain this item
      records = await listRecords(dashboardTableId);
      stored = records.find((r) => r.id === dashboard.id);
      const lookupValue = stored?.fields[dashboardConditionalLookupFieldId];
      if (lookupValue) {
        expect(lookupValue).not.toContain('Will Be Archived');
      }
    });

    it('updates lookup when item Status changes from Archived to Active', async () => {
      // Create Archived item
      const item = await createRecord(itemsTableId, {
        [itemsPrimaryFieldId]: 'Status Change Item 2',
        [itemsStatusFieldId]: 'Archived',
        [itemsLabelFieldId]: 'Will Be Active',
      });

      // Create dashboard
      const dashboard = await createRecord(dashboardTableId, {
        [dashboardPrimaryFieldId]: 'Status Change Dashboard 2',
      });
      await processOutbox();

      // Initial lookup should not contain the item
      let records = await listRecords(dashboardTableId);
      let stored = records.find((r) => r.id === dashboard.id);
      const initialLookup = stored?.fields[dashboardConditionalLookupFieldId];
      if (initialLookup) {
        expect(initialLookup).not.toContain('Will Be Active');
      }

      // Change status from Archived to Active (record joins the result set)
      await updateRecord(itemsTableId, item.id, {
        [itemsStatusFieldId]: 'Active',
      });
      await processOutbox();

      // Lookup should now contain this item
      records = await listRecords(dashboardTableId);
      stored = records.find((r) => r.id === dashboard.id);
      expect(stored?.fields[dashboardConditionalLookupFieldId]).toContain('Will Be Active');
    });
  });
});
