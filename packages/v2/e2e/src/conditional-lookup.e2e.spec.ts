/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateFieldOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { sql } from 'kysely';
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

  const updateField = async (tableId: string, fieldId: string, field: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, fieldId, field }),
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`UpdateField failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = updateFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to update field: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.table;
  };

  const listRecords = async (
    tableId: string,
    options?: {
      sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    }
  ) => {
    const params = new URLSearchParams({ baseId: ctx.baseId, tableId });
    if (options?.sort) {
      params.set('sort', JSON.stringify(options.sort));
    }

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
    });
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

  const getDbTableName = async (tableId: string) => {
    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', tableId)
      .executeTakeFirst();

    const dbTableName = tableMeta?.db_table_name;
    if (!dbTableName) {
      throw new Error(`Failed to resolve db_table_name for table ${tableId}`);
    }

    return dbTableName;
  };

  const setRecordSystemTime = async (
    tableId: string,
    recordId: string,
    columnName: '__created_time' | '__last_modified_time',
    time: string
  ) => {
    const dbTableName = await getDbTableName(tableId);

    await sql`
      UPDATE ${sql.table(dbTableName)}
      SET ${sql.ref(columnName)} = ${time}
      WHERE "__id" = ${recordId}
    `.execute(ctx.testContainer.db);
  };

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
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

    it('matches text field against lookup field reference values stored as arrays', async () => {
      const categoryNameFieldId = createFieldId();
      const categoryTable = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_LookupRef_Category',
        fields: [
          { type: 'singleLineText', id: categoryNameFieldId, name: 'Name', isPrimary: true },
        ],
        records: [{ fields: { [categoryNameFieldId]: '你好' } }],
      });

      const foreignTitleFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_LookupRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title', isPrimary: true },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        records: [
          { fields: { [foreignTitleFieldId]: '命中', [foreignCategoryFieldId]: '你好' } },
          { fields: { [foreignTitleFieldId]: '未命中', [foreignCategoryFieldId]: '世界' } },
        ],
      });

      const hostNameFieldId = createFieldId();
      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_LookupRef_Host',
        fields: [{ type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true }],
        records: [{ fields: { [hostNameFieldId]: 'Host Lookup Ref' } }],
      });

      const categoryLinkFieldId = createFieldId();
      await createField(host.id, {
        type: 'link',
        id: categoryLinkFieldId,
        name: 'Category Link',
        options: {
          relationship: 'manyOne',
          foreignTableId: categoryTable.id,
          lookupFieldId: categoryNameFieldId,
        },
      });

      const categoryLookupFieldId = createFieldId();
      await createField(host.id, {
        type: 'lookup',
        id: categoryLookupFieldId,
        name: 'Category Lookup',
        options: {
          foreignTableId: categoryTable.id,
          linkFieldId: categoryLinkFieldId,
          lookupFieldId: categoryNameFieldId,
        },
      });

      const categoryRecords = await listRecords(categoryTable.id);
      const hostRecordsBeforeLink = await listRecords(host.id);
      const categoryRecordId = categoryRecords[0]?.id;
      const hostRecordId = hostRecordsBeforeLink[0]?.id;
      if (!categoryRecordId || !hostRecordId) {
        throw new Error('Missing category or host record for lookup field reference test');
      }

      await updateRecord(host.id, hostRecordId, {
        [categoryLinkFieldId]: { id: categoryRecordId },
      });

      const conditionalLookupFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: conditionalLookupFieldId,
        name: 'Matched Titles From Lookup Ref',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignTitleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignCategoryFieldId,
                  operator: 'is',
                  value: categoryLookupFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(host.id);
      const hostRecord = hostRecords[0];

      expect(hostRecord.fields[categoryLookupFieldId]).toEqual(['你好']);
      expect(hostRecord.fields[conditionalLookupFieldId]).toEqual(['命中']);
    });

    it('matches text field against conditional lookup field reference values stored as arrays', async () => {
      const foreignTitleFieldId = createFieldId();
      const foreignCategoryFieldId = createFieldId();
      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_ConditionalRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title', isPrimary: true },
          { type: 'singleLineText', id: foreignCategoryFieldId, name: 'Category' },
        ],
        records: [
          { fields: { [foreignTitleFieldId]: '命中', [foreignCategoryFieldId]: '你好' } },
          { fields: { [foreignTitleFieldId]: '未命中', [foreignCategoryFieldId]: '世界' } },
        ],
      });

      const categorySourceStatusFieldId = createFieldId();
      const categorySourceNameFieldId = createFieldId();
      const categorySource = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_ConditionalRef_Source',
        fields: [
          {
            type: 'singleLineText',
            id: categorySourceNameFieldId,
            name: 'Category Name',
            isPrimary: true,
          },
          { type: 'singleLineText', id: categorySourceStatusFieldId, name: 'Status' },
        ],
        records: [
          {
            fields: {
              [categorySourceNameFieldId]: '你好',
              [categorySourceStatusFieldId]: 'Active',
            },
          },
          {
            fields: {
              [categorySourceNameFieldId]: '世界',
              [categorySourceStatusFieldId]: 'Closed',
            },
          },
        ],
      });

      const hostNameFieldId = createFieldId();
      const hostStatusFieldId = createFieldId();
      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_ConditionalRef_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: hostStatusFieldId, name: 'Status Filter' },
        ],
        records: [
          { fields: { [hostNameFieldId]: 'Host Conditional Ref', [hostStatusFieldId]: 'Active' } },
        ],
      });

      const derivedCategoryFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: derivedCategoryFieldId,
        name: 'Derived Category',
        options: {
          foreignTableId: categorySource.id,
          lookupFieldId: categorySourceNameFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: categorySourceStatusFieldId,
                  operator: 'is',
                  value: hostStatusFieldId,
                  isSymbol: true,
                },
              ],
            },
            limit: 1,
          },
        },
      });

      const matchedTitlesFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: matchedTitlesFieldId,
        name: 'Matched Titles From Conditional Ref',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignTitleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignCategoryFieldId,
                  operator: 'is',
                  value: derivedCategoryFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(host.id);
      const hostRecord = hostRecords[0];

      expect(hostRecord.fields[derivedCategoryFieldId]).toEqual(['你好']);
      expect(hostRecord.fields[matchedTitlesFieldId]).toEqual(['命中']);
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

      // Verify Gamma now appears in lookup
      hostRecords = await listRecords(host.id);
      activeRecord = hostRecords[0];
      expect(activeRecord.fields[lookupFieldId]).toEqual(['Alpha', 'Beta', 'Gamma']);

      // Update Gamma's title
      await updateRecord(foreign.id, gammaRecord!.id, {
        [titleFieldId]: 'Gamma Updated',
      });

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

      // Verify Gamma is no longer in lookup
      hostRecords = await listRecords(host.id);
      activeRecord = hostRecords[0];
      expect(activeRecord.fields[lookupFieldId]).toEqual(['Alpha', 'Beta']);
    });
  });

  describe('date field reference filters', () => {
    it('keeps date=date parity when date=system time fields use field timezones', async () => {
      const foreignTitleFieldId = createFieldId();
      const foreignDateFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_DateRef_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title', isPrimary: true },
          {
            type: 'date',
            id: foreignDateFieldId,
            name: 'Event Date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' },
            },
          },
        ],
      });

      await createRecord(foreign.id, {
        [foreignTitleFieldId]: 'Previous Day Event',
        [foreignDateFieldId]: '2026-03-09',
      });
      await createRecord(foreign.id, {
        [foreignTitleFieldId]: 'Current Day Event',
        [foreignDateFieldId]: '2026-03-10',
      });

      const hostNameFieldId = createFieldId();
      const hostDateFilterFieldId = createFieldId();
      const hostCreatedTimeFieldId = createFieldId();
      const hostLastModifiedTimeFieldId = createFieldId();

      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_DateRef_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name', isPrimary: true },
          {
            type: 'date',
            id: hostDateFilterFieldId,
            name: 'Date Filter',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' },
            },
          },
          {
            type: 'createdTime',
            id: hostCreatedTimeFieldId,
            name: 'Created At',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
            },
          },
          {
            type: 'lastModifiedTime',
            id: hostLastModifiedTimeFieldId,
            name: 'Last Modified At',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
            },
          },
        ],
      });

      const hostRecord = await createRecord(host.id, {
        [hostNameFieldId]: 'Host Row',
        [hostDateFilterFieldId]: '2026-03-10',
      });

      await setRecordSystemTime(
        host.id,
        hostRecord.id,
        '__created_time',
        '2026-03-09T16:30:00.000Z'
      );
      await setRecordSystemTime(
        host.id,
        hostRecord.id,
        '__last_modified_time',
        '2026-03-09T16:30:00.000Z'
      );

      const dateEqualsDateFieldId = createFieldId();
      const dateEqualsCreatedTimeFieldId = createFieldId();
      const dateEqualsLastModifiedTimeFieldId = createFieldId();

      await createField(host.id, {
        type: 'conditionalLookup',
        id: dateEqualsDateFieldId,
        name: 'Date Equals Date',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignTitleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignDateFieldId,
                  operator: 'is',
                  value: hostDateFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await createField(host.id, {
        type: 'conditionalLookup',
        id: dateEqualsCreatedTimeFieldId,
        name: 'Date Equals CreatedTime',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignTitleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignDateFieldId,
                  operator: 'is',
                  value: hostCreatedTimeFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await createField(host.id, {
        type: 'conditionalLookup',
        id: dateEqualsLastModifiedTimeFieldId,
        name: 'Date Equals LastModifiedTime',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignTitleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignDateFieldId,
                  operator: 'is',
                  value: hostLastModifiedTimeFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      const hostRecords = await listRecords(host.id);
      expect(hostRecords).toHaveLength(1);

      const hostFields = hostRecords[0]!.fields;
      expect(hostFields[hostCreatedTimeFieldId]).toBe('2026-03-09T16:30:00.000Z');
      expect(hostFields[hostLastModifiedTimeFieldId]).toBe('2026-03-09T16:30:00.000Z');
      expect(hostFields[dateEqualsDateFieldId]).toEqual(['Current Day Event']);
      expect(hostFields[dateEqualsCreatedTimeFieldId]).toEqual(['Current Day Event']);
      expect(hostFields[dateEqualsLastModifiedTimeFieldId]).toEqual(['Current Day Event']);
    });
  });

  describe('user field filter lookup', () => {
    const listUserIds = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap((entry) => {
            if (typeof entry !== 'object' || entry == null || !('id' in entry)) {
              return [];
            }
            const id = (entry as { id?: unknown }).id;
            return typeof id === 'string' ? [id] : [];
          })
        : [];

    const setupSingleOwnerVsMultiAssigneesLookup = async (operator: 'is' | 'isNot') => {
      const titleFieldId = createFieldId();
      const ownerFieldId = createFieldId();
      const assigneesFieldId = createFieldId();
      const aliceCell = { id: ctx.testUser.id, title: ctx.testUser.name };
      const bobCell = { id: 'usrConditionalLookupUserBob', title: 'Bob' };

      await sql`
        insert into users (id, name, email)
        values (${bobCell.id}, ${bobCell.title}, ${'bob+conditional-lookup@e2e.com'})
        on conflict (id) do nothing
      `.execute(ctx.testContainer.db);

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
          { fields: { [titleFieldId]: 'Task Alpha', [ownerFieldId]: aliceCell } },
          { fields: { [titleFieldId]: 'Task Beta', [ownerFieldId]: aliceCell } },
          { fields: { [titleFieldId]: 'Task Gamma', [ownerFieldId]: bobCell } },
        ],
      });

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
          { fields: { [assigneesFieldId]: [aliceCell] } },
          { fields: { [assigneesFieldId]: [bobCell] } },
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
                  operator,
                  value: assigneesFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      return { host, assigneesFieldId, lookupFieldId, aliceCell, bobCell };
    };

    it('should match single user against multi user reference', async () => {
      const { host, assigneesFieldId, lookupFieldId, aliceCell, bobCell } =
        await setupSingleOwnerVsMultiAssigneesLookup('is');
      const hostRecords = await listRecords(host.id);
      const aliceRecord = hostRecords.find((record) =>
        listUserIds(record.fields[assigneesFieldId]).includes(aliceCell.id)
      );
      const bobRecord = hostRecords.find((record) =>
        listUserIds(record.fields[assigneesFieldId]).includes(bobCell.id)
      );

      expect(aliceRecord).toBeDefined();
      expect(bobRecord).toBeDefined();

      const aliceTasks = [...((aliceRecord!.fields[lookupFieldId] as string[]) ?? [])].sort();
      const bobTasks = [...((bobRecord!.fields[lookupFieldId] as string[]) ?? [])].sort();

      expect(aliceTasks).toEqual(['Task Alpha', 'Task Beta']);
      expect(bobTasks).toEqual(['Task Gamma']);
    });

    it('should exclude matching single user against multi user reference with isNot', async () => {
      const { host, assigneesFieldId, lookupFieldId, aliceCell, bobCell } =
        await setupSingleOwnerVsMultiAssigneesLookup('isNot');
      const hostRecords = await listRecords(host.id);
      const aliceRecord = hostRecords.find((record) =>
        listUserIds(record.fields[assigneesFieldId]).includes(aliceCell.id)
      );
      const bobRecord = hostRecords.find((record) =>
        listUserIds(record.fields[assigneesFieldId]).includes(bobCell.id)
      );

      expect(aliceRecord).toBeDefined();
      expect(bobRecord).toBeDefined();

      const aliceTasks = [...((aliceRecord!.fields[lookupFieldId] as string[]) ?? [])].sort();
      const bobTasks = [...((bobRecord!.fields[lookupFieldId] as string[]) ?? [])].sort();

      expect(aliceTasks).toEqual(['Task Gamma']);
      expect(bobTasks).toEqual(['Task Alpha', 'Task Beta']);
    });
  });

  describe('field reference compatibility validation', () => {
    it('keeps conditional lookup healthy when lookup target converts from singleLineText to longText', async () => {
      const taskFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_TargetType_Foreign',
        fields: [
          { type: 'singleLineText', id: taskFieldId, name: 'Task' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
        ],
        records: [
          { fields: { [taskFieldId]: 'Task Alpha', [foreignStatusFieldId]: 'Active' } },
          { fields: { [taskFieldId]: 'Task Beta', [foreignStatusFieldId]: 'Active' } },
          { fields: { [taskFieldId]: 'Task Gamma', [foreignStatusFieldId]: 'Closed' } },
        ],
      });

      const hostStatusFieldId = createFieldId();
      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_TargetType_Host',
        fields: [{ type: 'singleLineText', id: hostStatusFieldId, name: 'Status Filter' }],
        records: [{ fields: { [hostStatusFieldId]: 'Active' } }],
      });

      const lookupFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Matched Tasks',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: taskFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostStatusFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      const hostRecordsBefore = await listRecords(host.id);
      expect(hostRecordsBefore[0]?.fields[lookupFieldId]).toEqual(['Task Alpha', 'Task Beta']);

      await updateField(foreign.id, taskFieldId, {
        type: 'longText',
        name: 'Task',
        options: {},
      });

      await ctx.testContainer.processOutbox();

      const tableAfterConversion = await getTableById(host.id);
      const lookupAfterConversion = tableAfterConversion.fields.find(
        (field) => field.id === lookupFieldId
      ) as
        | {
            type?: string;
            hasError?: boolean;
            conditionalLookupOptions?: { lookupFieldId?: string };
          }
        | undefined;
      expect(lookupAfterConversion?.type).toBe('longText');
      expect(lookupAfterConversion?.hasError).toBeFalsy();
      expect(lookupAfterConversion?.conditionalLookupOptions?.lookupFieldId).toBe(taskFieldId);

      const foreignRecords = await listRecords(foreign.id);
      const activeRecord = foreignRecords.find(
        (record) => record.fields[foreignStatusFieldId] === 'Active'
      );
      expect(activeRecord).toBeDefined();
      if (!activeRecord) {
        throw new Error('Missing active foreign record');
      }

      await updateRecord(foreign.id, activeRecord.id, {
        [taskFieldId]: 'Task Alpha\nLine 2',
      });

      await ctx.testContainer.processOutbox();

      const hostRecordsAfter = await listRecords(host.id);
      expect(hostRecordsAfter[0]?.fields[lookupFieldId]).toEqual([
        'Task Alpha\nLine 2',
        'Task Beta',
      ]);
    });

    it('marks conditional lookup field as errored when reference field type changes', async () => {
      const taskFieldId = createFieldId();
      const foreignOwnerFieldId = createFieldId();
      const userCell = { id: ctx.testUser.id, title: ctx.testUser.name };

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Compatibility_Foreign',
        fields: [
          { type: 'singleLineText', id: taskFieldId, name: 'Task' },
          {
            type: 'user',
            id: foreignOwnerFieldId,
            name: 'Owner',
            options: { isMultiple: false },
          },
        ],
        records: [
          { fields: { [taskFieldId]: 'Task Alpha', [foreignOwnerFieldId]: userCell } },
          { fields: { [taskFieldId]: 'Task Beta' } },
        ],
      });

      const hostAssignedFieldId = createFieldId();
      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Compatibility_Host',
        fields: [
          {
            type: 'user',
            id: hostAssignedFieldId,
            name: 'Assigned',
            options: { isMultiple: false },
          },
        ],
        records: [{ fields: { [hostAssignedFieldId]: userCell } }],
      });

      const lookupFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Owned Tasks',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: taskFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignOwnerFieldId,
                  operator: 'is',
                  value: hostAssignedFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      const tableBefore = await getTableById(host.id);
      const lookupBefore = tableBefore.fields.find((field) => field.id === lookupFieldId) as
        | { hasError?: boolean }
        | undefined;
      expect(lookupBefore?.hasError).toBeFalsy();

      await updateField(host.id, hostAssignedFieldId, {
        type: 'singleLineText',
        name: 'Assigned',
        options: {},
      });

      await ctx.testContainer.processOutbox();

      const tableAfter = await getTableById(host.id);
      const lookupAfter = tableAfter.fields.find((field) => field.id === lookupFieldId) as
        | { hasError?: boolean }
        | undefined;
      expect(lookupAfter?.hasError).toBe(true);
    });

    it('marks conditional lookup field as errored when foreign field type changes', async () => {
      const taskFieldId = createFieldId();
      const foreignOwnerFieldId = createFieldId();
      const userCell = { id: ctx.testUser.id, title: ctx.testUser.name };

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Compatibility_ForeignKey',
        fields: [
          { type: 'singleLineText', id: taskFieldId, name: 'Task' },
          {
            type: 'user',
            id: foreignOwnerFieldId,
            name: 'Owner',
            options: { isMultiple: false },
          },
        ],
        records: [
          { fields: { [taskFieldId]: 'Task Alpha', [foreignOwnerFieldId]: userCell } },
          { fields: { [taskFieldId]: 'Task Beta', [foreignOwnerFieldId]: userCell } },
        ],
      });

      const hostAssignedFieldId = createFieldId();
      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_Compatibility_HostKey',
        fields: [
          {
            type: 'user',
            id: hostAssignedFieldId,
            name: 'Assigned',
            options: { isMultiple: false },
          },
        ],
        records: [{ fields: { [hostAssignedFieldId]: userCell } }],
      });

      const lookupFieldId = createFieldId();
      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Owned Tasks',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: taskFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignOwnerFieldId,
                  operator: 'is',
                  value: hostAssignedFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      const tableBefore = await getTableById(host.id);
      const lookupBefore = tableBefore.fields.find((field) => field.id === lookupFieldId) as
        | { hasError?: boolean }
        | undefined;
      expect(lookupBefore?.hasError).toBeFalsy();

      await updateField(foreign.id, foreignOwnerFieldId, {
        type: 'singleLineText',
        name: 'Owner',
        options: {},
      });

      await ctx.testContainer.processOutbox();

      const tableAfter = await getTableById(host.id);
      const lookupAfter = tableAfter.fields.find((field) => field.id === lookupFieldId) as
        | { hasError?: boolean }
        | undefined;
      expect(lookupAfter?.hasError).toBe(true);
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

      // Verify: should get top 2 scores in descending order (30, 20)
      const hostRecords = await listRecords(host.id);
      const activeRecord = hostRecords[0];

      expect(activeRecord.fields[lookupFieldId]).toEqual([30, 20]);
    });

    it('should sort host records by conditional lookup number values', async () => {
      const foreignNameFieldId = createFieldId();
      const foreignStatusFieldId = createFieldId();
      const foreignScoreFieldId = createFieldId();

      const foreign = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_RecordSort_Foreign',
        fields: [
          { type: 'singleLineText', id: foreignNameFieldId, name: 'Name' },
          { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
          { type: 'number', id: foreignScoreFieldId, name: 'Score' },
        ],
        records: [
          {
            fields: {
              [foreignNameFieldId]: 'Row-5',
              [foreignStatusFieldId]: 'S5',
              [foreignScoreFieldId]: 5,
            },
          },
          {
            fields: {
              [foreignNameFieldId]: 'Row-20',
              [foreignStatusFieldId]: 'S20',
              [foreignScoreFieldId]: 20,
            },
          },
          {
            fields: {
              [foreignNameFieldId]: 'Row-30',
              [foreignStatusFieldId]: 'S30',
              [foreignScoreFieldId]: 30,
            },
          },
        ],
      });

      const hostNameFieldId = createFieldId();
      const hostStatusFilterFieldId = createFieldId();

      const host = await createTable({
        baseId: ctx.baseId,
        name: 'ConditionalLookup_RecordSort_Host',
        fields: [
          { type: 'singleLineText', id: hostNameFieldId, name: 'Name' },
          { type: 'singleLineText', id: hostStatusFilterFieldId, name: 'StatusFilter' },
        ],
        records: [
          { fields: { [hostNameFieldId]: 'Host-30', [hostStatusFilterFieldId]: 'S30' } },
          { fields: { [hostNameFieldId]: 'Host-5', [hostStatusFilterFieldId]: 'S5' } },
          { fields: { [hostNameFieldId]: 'Host-20', [hostStatusFilterFieldId]: 'S20' } },
        ],
      });

      const lookupFieldId = createFieldId();

      await createField(host.id, {
        type: 'conditionalLookup',
        id: lookupFieldId,
        name: 'Matched Scores',
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignScoreFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: foreignStatusFieldId,
                  operator: 'is',
                  value: hostStatusFilterFieldId,
                  isSymbol: true,
                },
              ],
            },
          },
        },
      });

      await ctx.testContainer.processOutbox();

      const ascRecords = await listRecords(host.id, {
        sort: [{ fieldId: lookupFieldId, order: 'asc' }],
      });
      expect(ascRecords.map((record) => record.fields[lookupFieldId])).toEqual([[5], [20], [30]]);
      expect(ascRecords.map((record) => record.fields[hostNameFieldId])).toEqual([
        'Host-5',
        'Host-20',
        'Host-30',
      ]);

      const descRecords = await listRecords(host.id, {
        sort: [{ fieldId: lookupFieldId, order: 'desc' }],
      });
      expect(descRecords.map((record) => record.fields[lookupFieldId])).toEqual([[30], [20], [5]]);
      expect(descRecords.map((record) => record.fields[hostNameFieldId])).toEqual([
        'Host-30',
        'Host-20',
        'Host-5',
      ]);
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

      await drainOutbox();

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

      await drainOutbox();

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

      await drainOutbox();

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

      await drainOutbox();

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

      await drainOutbox();

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
