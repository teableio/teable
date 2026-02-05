/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http conditional lookup (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateTable failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const createField = async (tableId: string, field: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: ctx.baseId, tableId, field }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = (await response.json()) as any;
    if ((response.status !== 201 && response.status !== 200) || !rawBody.ok) {
      throw new Error(`CreateField failed: ${JSON.stringify(rawBody)}`);
    }
    return rawBody.data.field;
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fields }),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateRecord failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create record: ${JSON.stringify(rawBody)}`);
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

  const listRecords = async (tableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/listRecords?baseId=${ctx.baseId}&tableId=${tableId}`,
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

  const getTableById = async (tableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${tableId}`,
      {
        method: 'GET',
      }
    );
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`GetTableById failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to get table: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('basic text filter lookup', () => {
    it('should filter lookup based on host field value', async () => {
      // Create foreign table with Title and Status fields
      const titleFieldId = createFieldId();
      const statusFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Foreign',
        fields: [
          { type: 'singleLineText', id: titleFieldId, name: 'Title' },
          { type: 'singleLineText', id: statusFieldId, name: 'Status' },
        ],
        records: [
          { fields: { [titleFieldId]: 'Alpha', [statusFieldId]: 'Active' } },
          { fields: { [titleFieldId]: 'Beta', [statusFieldId]: 'Active' } },
          { fields: { [titleFieldId]: 'Gamma', [statusFieldId]: 'Closed' } },
        ],
      });

      // Create host table with StatusFilter field
      const statusFilterFieldId = createFieldId();

      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Host',
        fields: [{ type: 'singleLineText', id: statusFilterFieldId, name: 'StatusFilter' }],
        records: [
          { fields: { [statusFilterFieldId]: 'Active' } },
          { fields: { [statusFilterFieldId]: 'Closed' } },
        ],
      });

      const lookupFieldId = createFieldId();

      // Create conditional lookup field
      // Filter: foreign.Status == host.StatusFilter
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Matching Titles',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusFieldId,
                  operator: 'is',
                  value: statusFilterFieldId, // Field reference - the host field ID to compare against
                  isSymbol: true, // This indicates value is a field reference, not a literal
                },
              ],
            },
          },
        },
      });

      // Process outbox to compute lookup values
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox(); // May need multiple passes

      // Get records and verify lookup values
      const hostRecords = await listRecords(host.id);
      const activeRecord = hostRecords.find((r) => r.fields[statusFilterFieldId] === 'Active');
      const closedRecord = hostRecords.find((r) => r.fields[statusFilterFieldId] === 'Closed');

      expect(activeRecord).toBeDefined();
      expect(closedRecord).toBeDefined();

      // Active record should see Alpha and Beta
      expect(activeRecord!.fields[lookupFieldId]).toEqual(['Alpha', 'Beta']);

      // Closed record should see Gamma
      expect(closedRecord!.fields[lookupFieldId]).toEqual(['Gamma']);
    });

    it('should refresh conditional lookup when foreign records enter the filter', async () => {
      // Create foreign table
      const titleFieldId = createFieldId();
      const statusFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Foreign2',
        fields: [
          { type: 'singleLineText', id: titleFieldId, name: 'Title' },
          { type: 'singleLineText', id: statusFieldId, name: 'Status' },
        ],
        records: [
          { fields: { [titleFieldId]: 'Alpha', [statusFieldId]: 'Active' } },
          { fields: { [titleFieldId]: 'Beta', [statusFieldId]: 'Active' } },
          { fields: { [titleFieldId]: 'Gamma', [statusFieldId]: 'Closed' } },
        ],
      });

      // Create host table
      const statusFilterFieldId = createFieldId();

      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Host2',
        fields: [{ type: 'singleLineText', id: statusFilterFieldId, name: 'StatusFilter' }],
        records: [{ fields: { [statusFilterFieldId]: 'Active' } }],
      });

      const lookupFieldId = createFieldId();

      // Create conditional lookup
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Matching Titles',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusFieldId,
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

      // Verify baseline
      let hostRecords = await listRecords(host.id);
      let activeRecord = hostRecords[0];
      expect(activeRecord.fields[lookupFieldId]).toEqual(['Alpha', 'Beta']);

      // Update Gamma's status to Active
      const foreignRecords = await listRecords(foreign.id);
      const gammaRecord = foreignRecords.find((r) => r.fields[titleFieldId] === 'Gamma');
      expect(gammaRecord).toBeDefined();

      await updateRecord(foreign.id, gammaRecord!.id, {
        [statusFieldId]: 'Active',
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify Gamma now appears in lookup
      hostRecords = await listRecords(host.id);
      activeRecord = hostRecords[0];
      expect(activeRecord.fields[lookupFieldId]).toEqual(['Alpha', 'Beta', 'Gamma']);

      // Update Gamma's title
      await updateRecord(foreign.id, gammaRecord!.id, {
        [titleFieldId]: 'Gamma Updated',
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify title change is reflected
      hostRecords = await listRecords(host.id);
      activeRecord = hostRecords[0];
      expect(activeRecord.fields[lookupFieldId]).toEqual(['Alpha', 'Beta', 'Gamma Updated']);

      // Restore Gamma to Closed
      await updateRecord(foreign.id, gammaRecord!.id, {
        [titleFieldId]: 'Gamma',
        [statusFieldId]: 'Closed',
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify Gamma is no longer in lookup
      hostRecords = await listRecords(host.id);
      activeRecord = hostRecords[0];
      expect(activeRecord.fields[lookupFieldId]).toEqual(['Alpha', 'Beta']);
    });
  });

  describe('user field filter lookup', () => {
    it('should match single user against multi user reference', async () => {
      const titleFieldId = createFieldId();
      const ownerFieldId = createFieldId();
      const userCell = { id: ctx.testUser.id, title: ctx.testUser.name };

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_User_Foreign_MultiHost',
        fields: [
          { type: 'singleLineText', id: titleFieldId, name: 'Task' },
          {
            type: 'user',
            id: ownerFieldId,
            name: 'Owner',
            options: { isMultiple: false },
          },
        ],
        records: [
          { fields: { [titleFieldId]: 'Task Alpha', [ownerFieldId]: userCell } },
          { fields: { [titleFieldId]: 'Task Beta', [ownerFieldId]: userCell } },
          { fields: { [titleFieldId]: 'Task Gamma' } },
        ],
      });

      const assigneesFieldId = createFieldId();
      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_User_Host_Multi',
        fields: [
          {
            type: 'user',
            id: assigneesFieldId,
            name: 'Assignees',
            options: { isMultiple: true },
          },
        ],
        records: [
          { fields: { [assigneesFieldId]: [userCell] } },
          { fields: { [assigneesFieldId]: null } },
        ],
      });

      const lookupFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Owned Tasks',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: ownerFieldId,
                  operator: 'is',
                  value: assigneesFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(host.id);
      const assignedRecord = hostRecords.find((record) => {
        const value = record.fields[assigneesFieldId] as Array<unknown> | null | undefined;
        return Array.isArray(value) && value.length > 0;
      });
      const emptyRecord = hostRecords.find((record) => {
        const value = record.fields[assigneesFieldId] as Array<unknown> | null | undefined;
        return !value || (Array.isArray(value) && value.length === 0);
      });

      expect(assignedRecord).toBeDefined();
      expect(emptyRecord).toBeDefined();

      const ownedTasks = [...((assignedRecord!.fields[lookupFieldId] as string[]) ?? [])].sort();
      expect(ownedTasks).toEqual(['Task Alpha', 'Task Beta']);
      expect((emptyRecord!.fields[lookupFieldId] as string[] | undefined) ?? []).toEqual([]);
    });
  });

  describe('sort and limit options', () => {
    it('should apply sort and limit to conditional lookup results', async () => {
      // Create foreign table with Title, Status, and Score fields
      const titleFieldId = createFieldId();
      const statusFieldId = createFieldId();
      const scoreFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Sorted',
        fields: [
          { type: 'singleLineText', id: titleFieldId, name: 'Title' },
          { type: 'singleLineText', id: statusFieldId, name: 'Status' },
          { type: 'number', id: scoreFieldId, name: 'Score' },
        ],
        records: [
          { fields: { [titleFieldId]: 'Item1', [statusFieldId]: 'Active', [scoreFieldId]: 10 } },
          { fields: { [titleFieldId]: 'Item2', [statusFieldId]: 'Active', [scoreFieldId]: 30 } },
          { fields: { [titleFieldId]: 'Item3', [statusFieldId]: 'Active', [scoreFieldId]: 20 } },
          { fields: { [titleFieldId]: 'Item4', [statusFieldId]: 'Inactive', [scoreFieldId]: 40 } },
        ],
      });

      // Create host table
      const statusFilterFieldId = createFieldId();

      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Host_Sorted',
        fields: [{ type: 'singleLineText', id: statusFilterFieldId, name: 'StatusFilter' }],
        records: [{ fields: { [statusFilterFieldId]: 'Active' } }],
      });

      const lookupFieldId = createFieldId();

      // Create conditional lookup with sort and limit
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Top Scores',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusFieldId,
                  operator: 'is',
                  value: statusFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
            sort: { fieldId: scoreFieldId, order: 'desc' },
            limit: 2,
          },
        },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify: should get top 2 scores in descending order (30, 20)
      const hostRecords = await listRecords(host.id);
      const activeRecord = hostRecords[0];

      expect(activeRecord.fields[lookupFieldId]).toEqual([30, 20]);
    });
  });

  describe('multi-condition filters', () => {
    it('should support AND logic with multiple filter conditions', async () => {
      // Create foreign table with Category, Amount, and Title fields
      const categoryFieldId = createFieldId();
      const amountFieldId = createFieldId();
      const titleFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_MultiFilter',
        fields: [
          { type: 'singleLineText', id: categoryFieldId, name: 'Category' },
          { type: 'number', id: amountFieldId, name: 'Amount' },
          { type: 'singleLineText', id: titleFieldId, name: 'Title' },
        ],
        records: [
          { fields: { [titleFieldId]: 'Item1', [categoryFieldId]: 'A', [amountFieldId]: 100 } },
          { fields: { [titleFieldId]: 'Item2', [categoryFieldId]: 'A', [amountFieldId]: 50 } },
          { fields: { [titleFieldId]: 'Item3', [categoryFieldId]: 'B', [amountFieldId]: 150 } },
          { fields: { [titleFieldId]: 'Item4', [categoryFieldId]: 'A', [amountFieldId]: 200 } },
        ],
      });

      // Create host table with filter criteria
      const categoryFilterFieldId = createFieldId();
      const minAmountFieldId = createFieldId();

      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Host_MultiFilter',
        fields: [
          { type: 'singleLineText', id: categoryFilterFieldId, name: 'CategoryFilter' },
          { type: 'number', id: minAmountFieldId, name: 'MinAmount' },
        ],
        records: [{ fields: { [categoryFilterFieldId]: 'A', [minAmountFieldId]: 75 } }],
      });

      const lookupFieldId = createFieldId();

      // Create conditional lookup with multiple conditions
      // Filter: Category == CategoryFilter AND Amount > MinAmount
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Matching Items',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: categoryFieldId,
                  operator: 'is',
                  value: categoryFilterFieldId,
                  isSymbol: true,
                },
                {
                  fieldId: amountFieldId,
                  operator: 'isGreater',
                  value: minAmountFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Verify: should get Item1 (A, 100) and Item4 (A, 200)
      const hostRecords = await listRecords(host.id);
      const filterRecord = hostRecords[0];

      expect(filterRecord.fields[lookupFieldId]).toEqual(['Item1', 'Item4']);
    });
  });

  describe('isEmpty and isNotEmpty operators', () => {
    it('should handle isEmpty and isNotEmpty operators correctly', async () => {
      // Create foreign table with optional field
      const titleFieldId = createFieldId();
      const notesFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Empty',
        fields: [
          { type: 'singleLineText', id: titleFieldId, name: 'Title' },
          { type: 'singleLineText', id: notesFieldId, name: 'Notes' },
        ],
        records: [
          { fields: { [titleFieldId]: 'WithNotes', [notesFieldId]: 'Some notes' } },
          { fields: { [titleFieldId]: 'WithoutNotes', [notesFieldId]: null } },
          { fields: { [titleFieldId]: 'EmptyNotes', [notesFieldId]: '' } },
        ],
      });

      // Create host table
      const lookupEmptyFieldId = createFieldId();
      const lookupNotEmptyFieldId = createFieldId();

      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Host_Empty',
        fields: [{ type: 'singleLineText', id: createFieldId(), name: 'Label' }],
        records: [{ fields: {} }],
      });

      // Create lookup for isEmpty
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupEmptyFieldId,
        name: 'Items With Empty Notes',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: notesFieldId,
                  operator: 'isEmpty',
                },
              ],
            },
          },
        },
      });

      // Create lookup for isNotEmpty
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupNotEmptyFieldId,
        name: 'Items With Notes',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: notesFieldId,
                  operator: 'isNotEmpty',
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(host.id);
      const record = hostRecords[0];

      // isEmpty should match records with null or empty string
      expect(record.fields[lookupEmptyFieldId]).toEqual(['WithoutNotes', 'EmptyNotes']);

      // isNotEmpty should match records with actual content
      expect(record.fields[lookupNotEmptyFieldId]).toEqual(['WithNotes']);
    });
  });

  describe('conditional lookup referencing derived field types', () => {
    it('refreshes lookup mirrors when conditional rollup values change', async () => {
      const supplierNameFieldId = createFieldId();
      const supplierRatingFieldId = createFieldId();

      const suppliers = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Supplier',
        fields: [
          { type: 'singleLineText', id: supplierNameFieldId, name: 'SupplierName' },
          { type: 'number', id: supplierRatingFieldId, name: 'Rating' },
        ],
        records: [
          { fields: { [supplierNameFieldId]: 'Supplier A', [supplierRatingFieldId]: 5 } },
          { fields: { [supplierNameFieldId]: 'Supplier B', [supplierRatingFieldId]: 4 } },
        ],
      });

      // Fetch suppliers records to get their IDs
      const suppliersRecords = await listRecords(suppliers.id);
      const supplierBRecordId = suppliersRecords.find(
        (record) => record.fields[supplierNameFieldId] === 'Supplier B'
      )?.id;
      if (!supplierBRecordId) {
        throw new Error('Missing Supplier B record');
      }

      const productNameFieldId = createFieldId();
      const productSupplierNameFieldId = createFieldId();
      const products = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Product',
        fields: [
          { type: 'singleLineText', id: productNameFieldId, name: 'ProductName' },
          { type: 'singleLineText', id: productSupplierNameFieldId, name: 'Supplier Name' },
        ],
        records: [
          {
            fields: { [productNameFieldId]: 'Laptop', [productSupplierNameFieldId]: 'Supplier A' },
          },
          {
            fields: { [productNameFieldId]: 'Mouse', [productSupplierNameFieldId]: 'Supplier B' },
          },
          {
            fields: {
              [productNameFieldId]: 'Subscription',
              [productSupplierNameFieldId]: 'Supplier B',
            },
          },
        ],
      });

      // Fetch products records to get their IDs
      const productsRecords = await listRecords(products.id);
      const subscriptionProductId = productsRecords.find(
        (record) => record.fields[productNameFieldId] === 'Subscription'
      )?.id;
      if (!subscriptionProductId) {
        throw new Error('Missing Subscription record');
      }

      const linkToSupplierFieldId = createFieldId();
      await createField(products.id, {
        type: 'link',
        id: linkToSupplierFieldId,
        name: 'Supplier Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: suppliers.id,
          lookupFieldId: supplierNameFieldId,
        },
      });

      const laptopProductId = productsRecords.find(
        (record) => record.fields[productNameFieldId] === 'Laptop'
      )?.id;
      const mouseProductId = productsRecords.find(
        (record) => record.fields[productNameFieldId] === 'Mouse'
      )?.id;
      if (!laptopProductId || !mouseProductId) {
        throw new Error('Missing product records');
      }

      const supplierARecordId = suppliersRecords.find(
        (record) => record.fields[supplierNameFieldId] === 'Supplier A'
      )?.id;
      if (!supplierARecordId) {
        throw new Error('Missing Supplier A record');
      }

      await updateRecord(products.id, laptopProductId, {
        [linkToSupplierFieldId]: { id: supplierARecordId },
      });
      await updateRecord(products.id, mouseProductId, {
        [linkToSupplierFieldId]: { id: supplierBRecordId },
      });
      await updateRecord(products.id, subscriptionProductId, {
        [linkToSupplierFieldId]: { id: supplierBRecordId },
      });

      const supplierRatingLookupFieldId = createFieldId();
      await createField(products.id, {
        type: 'lookup',
        id: supplierRatingLookupFieldId,
        name: 'Supplier Rating Lookup',
        options: {
          foreignTableId: suppliers.id,
          linkFieldId: linkToSupplierFieldId,
          lookupFieldId: supplierRatingFieldId,
        },
      });

      const minSupplierRatingFieldId = createFieldId();
      await createField(products.id, {
        type: 'number',
        id: minSupplierRatingFieldId,
        name: 'Minimum Supplier Rating',
        options: {
          formatting: {
            type: 'decimal',
            precision: 1,
          },
        },
      });

      await updateRecord(products.id, laptopProductId, {
        [minSupplierRatingFieldId]: 4.5,
      });
      await updateRecord(products.id, mouseProductId, {
        [minSupplierRatingFieldId]: 3.5,
      });
      await updateRecord(products.id, subscriptionProductId, {
        [minSupplierRatingFieldId]: 4.5,
      });

      const supplierRatingConditionalLookupId = createFieldId();
      await createField(products.id, {
        type: 'conditionalLookup',
        id: supplierRatingConditionalLookupId,
        name: 'Supplier Rating Conditional Lookup',
        options: {
          foreignTableId: suppliers.id,
          lookupFieldId: supplierRatingFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: supplierNameFieldId,
                  operator: 'is',
                  value: productSupplierNameFieldId,
                  isSymbol: true,
                },
                {
                  fieldId: supplierRatingFieldId,
                  operator: 'isGreaterEqual',
                  value: minSupplierRatingFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      const supplierRatingConditionalRollupId = createFieldId();
      await createField(products.id, {
        type: 'conditionalRollup',
        id: supplierRatingConditionalRollupId,
        name: 'Supplier Rating Conditional Sum',
        options: { expression: 'sum({values})' },
        config: {
          foreignTableId: suppliers.id,
          lookupFieldId: supplierRatingFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: supplierNameFieldId,
                  operator: 'is',
                  value: productSupplierNameFieldId,
                  isSymbol: true,
                },
                {
                  fieldId: supplierRatingFieldId,
                  operator: 'isGreaterEqual',
                  value: minSupplierRatingFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      const hostSummaryFieldId = createFieldId();
      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Derived_Host',
        fields: [{ type: 'singleLineText', id: hostSummaryFieldId, name: 'Summary' }],
        records: [{ fields: { [hostSummaryFieldId]: 'Global' } }],
      });

      const hostProductsLinkFieldId = createFieldId();
      await createField(host.id, {
        type: 'link',
        id: hostProductsLinkFieldId,
        name: 'Products Link',
        options: {
          relationship: 'manyMany',
          foreignTableId: products.id,
          lookupFieldId: productNameFieldId,
        },
      });

      // Fetch host records to get their IDs
      const initialHostRecords = await listRecords(host.id);
      const hostRecordId = initialHostRecords[0]?.id;
      if (!hostRecordId) {
        throw new Error('Missing host record');
      }

      await updateRecord(host.id, hostRecordId, {
        [hostProductsLinkFieldId]: productsRecords.map((record) => ({ id: record.id })),
      });

      const ratingValuesLookupFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: ratingValuesLookupFieldId,
        name: 'Supplier Ratings (Lookup)',
        options: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingLookupFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: supplierRatingLookupFieldId,
                  operator: 'isNotEmpty',
                },
              ],
            },
          },
        },
      });

      const conditionalLookupMirrorFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: conditionalLookupMirrorFieldId,
        name: 'Supplier Ratings (Conditional Lookup Source)',
        options: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingConditionalLookupId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: supplierRatingConditionalLookupId,
                  operator: 'isNotEmpty',
                },
              ],
            },
          },
        },
      });

      const conditionalRollupMirrorFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: conditionalRollupMirrorFieldId,
        name: 'Supplier Rating Conditional Sums (Lookup)',
        options: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingConditionalRollupId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: supplierRatingConditionalRollupId,
                  operator: 'isGreater',
                  value: 0,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(host.id);
      const hostRecord = hostRecords[0];

      const ratingValues = [...((hostRecord.fields[ratingValuesLookupFieldId] as number[]) || [])];
      ratingValues.sort((a, b) => a - b);
      expect(ratingValues).toEqual([4, 4, 5]);

      const baselineLookupValues = [
        ...((hostRecord.fields[conditionalLookupMirrorFieldId] as number[]) || []),
      ].sort((a, b) => a - b);
      const baselineRollupValues = [
        ...((hostRecord.fields[conditionalRollupMirrorFieldId] as number[]) || []),
      ].sort((a, b) => a - b);
      expect(baselineLookupValues).toEqual([4, 5]);
      expect(baselineRollupValues).toEqual([4, 5]);

      const productRecords = await listRecords(products.id);
      const baselineSubscription = productRecords.find(
        (record) => record.fields[productNameFieldId] === 'Subscription'
      );
      const baselineRollupValue = baselineSubscription?.fields[
        supplierRatingConditionalRollupId
      ] as number | null | undefined;
      expect(baselineRollupValue ?? 0).toBe(0);

      await updateRecord(suppliers.id, supplierBRecordId, {
        [supplierRatingFieldId]: 5,
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const afterBoostHost = await listRecords(host.id);
      const boostedLookupValues =
        (afterBoostHost[0].fields[conditionalLookupMirrorFieldId] as number[]) || [];
      const boostedRollupValues =
        (afterBoostHost[0].fields[conditionalRollupMirrorFieldId] as number[]) || [];

      const baselineFiveLookupCount = baselineLookupValues.filter((value) => value === 5).length;
      const baselineFiveRollupCount = baselineRollupValues.filter((value) => value === 5).length;

      expect(boostedLookupValues.filter((value) => value === 5).length).toBeGreaterThan(
        baselineFiveLookupCount
      );
      expect(boostedRollupValues.filter((value) => value === 5).length).toBeGreaterThan(
        baselineFiveRollupCount
      );

      const boostedProductRecords = await listRecords(products.id);
      const subscriptionAfterBoost = boostedProductRecords.find(
        (record) => record.fields[productNameFieldId] === 'Subscription'
      );
      expect(subscriptionAfterBoost?.fields[supplierRatingConditionalRollupId]).toEqual(5);

      await updateRecord(suppliers.id, supplierBRecordId, {
        [supplierRatingFieldId]: 4,
      });

      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      const restoredHost = await listRecords(host.id);
      const restoredLookupValues =
        (restoredHost[0].fields[conditionalLookupMirrorFieldId] as number[]) || [];
      const restoredRollupValues =
        (restoredHost[0].fields[conditionalRollupMirrorFieldId] as number[]) || [];

      expect(restoredLookupValues.filter((value) => value > 0).sort((a, b) => a - b)).toEqual(
        baselineLookupValues.filter((value) => value > 0)
      );
      expect(restoredRollupValues.filter((value) => value > 0).sort((a, b) => a - b)).toEqual(
        baselineRollupValues.filter((value) => value > 0)
      );
    });
  });
});
