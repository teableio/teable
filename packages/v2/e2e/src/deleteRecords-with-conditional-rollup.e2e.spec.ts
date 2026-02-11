/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Regression test for: deleting a record from a table referenced by a
 * conditionalRollup whose filter uses a conditionalLookup field with the
 * `hasNoneOf` operator.
 *
 * Root cause: FieldConditionSpecBuilder did not unwrap conditionalLookup
 * fields to their inner type for operator validation, so `hasNoneOf` was
 * rejected as invalid for a string-cellValueType field.
 */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  deleteRecordsOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 deleteRecords with conditionalRollup filtering on conditionalLookup (e2e)', () => {
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

  const deleteRecords = async (tableId: string, recordIds: string[]) => {
    const response = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
      method: 'DELETE',
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

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('should delete record without error when conditionalRollup filters on conditionalLookup with hasNoneOf', async () => {
    // =========================================================================
    // Table A (Source): provides singleSelect values via conditionalLookup
    // =========================================================================
    const aNameId = createFieldId();
    const aStatusId = createFieldId();
    const aCodeId = createFieldId();

    const tableA = await createTable({
      baseId: ctx.baseId,
      name: 'DeleteCondRollup_Source',
      fields: [
        { type: 'singleLineText', id: aNameId, name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          id: aStatusId,
          name: 'Status',
          options: {
            choices: [
              { name: 'active', color: 'blue' },
              { name: 'shipped', color: 'yellow' },
              { name: 'archived', color: 'gray' },
            ],
          },
        },
        { type: 'singleLineText', id: aCodeId, name: 'Code' },
      ],
      records: [
        { fields: { [aNameId]: 'S1', [aStatusId]: 'active', [aCodeId]: 'P001' } },
        { fields: { [aNameId]: 'S2', [aStatusId]: 'shipped', [aCodeId]: 'P001' } },
        { fields: { [aNameId]: 'S3', [aStatusId]: 'archived', [aCodeId]: 'P002' } },
      ],
    });

    // =========================================================================
    // Table B (Middle): has a conditionalLookup field that references Table A
    // This is the table we will DELETE records from.
    // =========================================================================
    const bNameId = createFieldId();
    const bAmountId = createFieldId();
    const bMatchCodeId = createFieldId();

    const tableB = await createTable({
      baseId: ctx.baseId,
      name: 'DeleteCondRollup_Middle',
      fields: [
        { type: 'singleLineText', id: bNameId, name: 'Name', isPrimary: true },
        { type: 'number', id: bAmountId, name: 'Amount' },
        { type: 'singleLineText', id: bMatchCodeId, name: 'MatchCode' },
      ],
    });

    // Create conditionalLookup field on Table B that looks up Status from Table A
    // Condition: tableA.Code == tableB.MatchCode
    const bStatusLookupId = createFieldId();
    await createField(tableB.id, {
      type: 'conditionalLookup',
      id: bStatusLookupId,
      name: 'StatusLookup',
      options: {
        foreignTableId: tableA.id,
        lookupFieldId: aStatusId,
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: aCodeId,
                operator: 'is',
                value: bMatchCodeId,
                isSymbol: true,
              },
            ],
          },
        },
      },
    });

    // Process outbox so the conditionalLookup field's inner field gets resolved
    await ctx.testContainer.processOutbox();

    // Create records in Table B
    const recB1 = await createRecord(tableB.id, {
      [bNameId]: 'B1',
      [bAmountId]: 100,
      [bMatchCodeId]: 'P001',
    });
    const recB2 = await createRecord(tableB.id, {
      [bNameId]: 'B2',
      [bAmountId]: 200,
      [bMatchCodeId]: 'P001',
    });

    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    // =========================================================================
    // Table C (Target): has a conditionalRollup that sums Amount from Table B
    // with filter: StatusLookup hasNoneOf ["archived"] AND MatchCode is {field ref}
    // =========================================================================
    const cNameId = createFieldId();
    const cProductCodeId = createFieldId();

    const tableC = await createTable({
      baseId: ctx.baseId,
      name: 'DeleteCondRollup_Target',
      fields: [
        { type: 'singleLineText', id: cNameId, name: 'Name', isPrimary: true },
        { type: 'singleLineText', id: cProductCodeId, name: 'ProductCode' },
      ],
    });

    // Create conditionalRollup field: sum Amount from Table B,
    // filtered by StatusLookup hasNoneOf ["archived"] and MatchCode == ProductCode
    const cTotalAmountId = createFieldId();
    await createField(tableC.id, {
      type: 'conditionalRollup',
      id: cTotalAmountId,
      name: 'TotalAmount',
      options: {
        expression: 'sum({values})',
        timeZone: 'utc',
      },
      config: {
        foreignTableId: tableB.id,
        lookupFieldId: bAmountId,
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: bStatusLookupId,
                operator: 'hasNoneOf',
                value: ['archived'],
              },
              {
                fieldId: bMatchCodeId,
                operator: 'is',
                value: cProductCodeId,
                isSymbol: true,
              },
            ],
          },
        },
      },
    });

    // Create a record in Table C
    await createRecord(tableC.id, {
      [cNameId]: 'C1',
      [cProductCodeId]: 'P001',
    });

    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    // Verify TotalAmount was computed
    const beforeRecords = await listRecords(tableC.id);
    expect(beforeRecords.length).toBeGreaterThan(0);
    const beforeTotal = beforeRecords[0].fields[cTotalAmountId];
    // Both B1 (100) and B2 (200) have StatusLookup = ["active", "shipped"] (not archived),
    // so they should both be included: 100 + 200 = 300
    expect(beforeTotal).toBe(300);

    // =========================================================================
    // THE BUG: Deleting a record from Table B should succeed.
    // Before the fix, this would fail with:
    //   "Invalid record condition operator for field"
    // because the computed update for the conditionalRollup in Table C
    // could not build the SQL for the hasNoneOf filter on the
    // conditionalLookup field StatusLookup.
    // =========================================================================
    const { status, rawBody } = await deleteRecords(tableB.id, [recB1.id]);

    expect(status).toBe(200);
    const parsed = deleteRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.ok) {
      expect(parsed.data.data.deletedRecordIds).toContain(recB1.id);
    }

    // Process computed updates after deletion
    await ctx.testContainer.processOutbox();
    await ctx.testContainer.processOutbox();

    // Verify TotalAmount was recomputed correctly (only B2 remains: 200)
    const afterRecords = await listRecords(tableC.id);
    expect(afterRecords.length).toBeGreaterThan(0);
    const afterTotal = afterRecords[0].fields[cTotalAmountId];
    expect(afterTotal).toBe(200);
  });
});
