/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordOkResponseSchema,
  createRecordsOkResponseSchema,
  createTableOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http record ordering (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let viewId: string;
  let textFieldId: string;

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

  const createRecord = async (
    tableIdParam: string,
    fields: Record<string, unknown>,
    order?: { viewId: string; anchorId: string; position: 'before' | 'after' }
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, fields, order }),
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

  const reorderRecords = async (
    tableIdParam: string,
    recordIds: string[],
    order: { viewId: string; anchorId: string; position: 'before' | 'after' }
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/reorderRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, recordIds, order }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to reorder records: ${errorText}`);
    }
    return (await response.json()) as { ok: boolean; data?: { updatedRecordIds: string[] } };
  };

  const createRecords = async (
    tableIdParam: string,
    records: Array<{ fields: Record<string, unknown> }>,
    order?: { viewId: string; anchorId: string; position: 'before' | 'after' }
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, records, order }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create records response');
    }
    return parsed.data.data.records;
  };

  const duplicateRecord = async (
    tableIdParam: string,
    recordIdParam: string,
    order?: { viewId: string; anchorId: string; position: 'before' | 'after' }
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/duplicateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, recordId: recordIdParam, order }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to duplicate record: ${errorText}`);
    }
    const rawBody = (await response.json()) as {
      ok: boolean;
      data?: { record: { id: string; fields: Record<string, unknown> } };
    };
    if (!rawBody.ok || !rawBody.data) {
      throw new Error('Failed to parse duplicate record response');
    }
    return rawBody.data.record;
  };

  const getRecordsInOrder = async (tableIdParam: string, viewIdParam: string) => {
    // Query the database directly to get records ordered by the view's order column
    const orderColumnName = `__row_${viewIdParam}`;
    const fullTableName = `${ctx.baseId}.${tableIdParam}`;

    const result = await sql<{ __id: string; order_value: number }>`
      SELECT __id, ${sql.ref(orderColumnName)} as order_value
      FROM ${sql.table(fullTableName)}
      ORDER BY ${sql.ref(orderColumnName)} ASC
    `.execute(ctx.testContainer.db);

    return result.rows;
  };

  /**
   * Helper to get ordered record IDs and look up their field values from an ID-to-fields map
   */
  const getOrderedRecordInfo = async (
    tableIdParam: string,
    viewIdParam: string,
    recordFieldMap: Map<string, Record<string, unknown>>,
    textFieldIdParam: string
  ) => {
    const orderedRows = await getRecordsInOrder(tableIdParam, viewIdParam);
    return orderedRows.map((row) => ({
      id: row.__id,
      name: recordFieldMap.get(row.__id)?.[textFieldIdParam] as string | undefined,
      order_value: row.order_value,
    }));
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Create a test table for record ordering tests
    const table = await createTable({
      baseId: ctx.baseId,
      name: 'Record Ordering Test Table',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    viewId = table.views[0].id;
    textFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
  });

  describe('createRecord with order', () => {
    it('should insert record before anchor record', async () => {
      // Create initial records A, B, C
      const recordA = await createRecord(tableId, { [textFieldId]: 'A' });
      const recordB = await createRecord(tableId, { [textFieldId]: 'B' });
      const recordC = await createRecord(tableId, { [textFieldId]: 'C' });

      // Create D before B
      const recordD = await createRecord(
        tableId,
        { [textFieldId]: 'D' },
        { viewId, anchorId: recordB.id, position: 'before' }
      );

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        [recordC.id, recordC.fields],
        [recordD.id, recordD.fields],
      ]);

      // Verify order: A, D, B, C
      const orderedRecords = await getOrderedRecordInfo(
        tableId,
        viewId,
        recordFieldMap,
        textFieldId
      );
      const names = orderedRecords.map((r) => r.name);

      // Find the indices
      const indexA = names.indexOf('A');
      const indexD = names.indexOf('D');
      const indexB = names.indexOf('B');
      const indexC = names.indexOf('C');

      // D should be between A and B
      expect(indexA).toBeLessThan(indexD);
      expect(indexD).toBeLessThan(indexB);
      expect(indexB).toBeLessThan(indexC);

      expect(recordD.id).toMatch(/^rec/);
    });

    it('should insert record after anchor record', async () => {
      // Create a new table for this test
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'After Anchor Test Table',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create initial records A, B, C
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });
      const recordC = await createRecord(testTableId, { [testTextFieldId]: 'C' });

      // Create D after B
      const recordD = await createRecord(
        testTableId,
        { [testTextFieldId]: 'D' },
        { viewId: testViewId, anchorId: recordB.id, position: 'after' }
      );

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        [recordC.id, recordC.fields],
        [recordD.id, recordD.fields],
      ]);

      // Verify order: A, B, D, C
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);

      const indexA = names.indexOf('A');
      const indexB = names.indexOf('B');
      const indexD = names.indexOf('D');
      const indexC = names.indexOf('C');

      // D should be between B and C
      expect(indexA).toBeLessThan(indexB);
      expect(indexB).toBeLessThan(indexD);
      expect(indexD).toBeLessThan(indexC);

      expect(recordD.id).toMatch(/^rec/);
    });

    it('should create order column on-demand when it does not exist', async () => {
      // Create a new table without any order operations yet
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'On-demand Order Column Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create first record normally (no order column yet)
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });

      // Create second record with order - this should create the order column
      const recordB = await createRecord(
        testTableId,
        { [testTextFieldId]: 'B' },
        { viewId: testViewId, anchorId: recordA.id, position: 'before' }
      );

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
      ]);

      // Verify order column was created and B is before A
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);

      expect(names.indexOf('B')).toBeLessThan(names.indexOf('A'));
    });
  });

  describe('reorderRecords', () => {
    it('reorders records via fetch endpoint', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Reorder Records Fetch Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });
      const recordC = await createRecord(testTableId, { [testTextFieldId]: 'C' });

      const response = await reorderRecords(testTableId, [recordC.id, recordB.id], {
        viewId: testViewId,
        anchorId: recordA.id,
        position: 'before',
      });
      expect(response.ok).toBe(true);
      expect(response.data?.updatedRecordIds).toEqual([recordC.id, recordB.id]);

      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        [recordC.id, recordC.fields],
      ]);
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);
      expect(names).toEqual(['C', 'B', 'A']);
    });

    it('reorders records via orpc client', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Reorder Records Orpc Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });
      const recordC = await createRecord(testTableId, { [testTextFieldId]: 'C' });

      const client = createV2HttpClient({ baseUrl: ctx.baseUrl });
      const body = await client.tables.reorderRecords({
        tableId: testTableId,
        recordIds: [recordA.id],
        order: { viewId: testViewId, anchorId: recordC.id, position: 'after' },
      });
      expect(body.ok).toBe(true);
      if (body.ok) {
        expect(body.data.updatedRecordIds).toEqual([recordA.id]);
      }

      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        [recordC.id, recordC.fields],
      ]);
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);
      expect(names[names.length - 1]).toBe('A');
    });

    it('reorders large batch via fetch endpoint (batch update path)', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Reorder Records Large Batch Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Use > 500 records to trigger batch update logic
      const batchCount = 520;
      const batchPayload = Array.from({ length: batchCount }, (_, i) => ({
        fields: { [testTextFieldId]: `R${String(i).padStart(3, '0')}` },
      }));
      const batchRecords = await createRecords(testTableId, batchPayload);
      const anchorRecord = await createRecord(testTableId, { [testTextFieldId]: 'Anchor' });

      const response = await reorderRecords(
        testTableId,
        batchRecords.map((record) => record.id),
        { viewId: testViewId, anchorId: anchorRecord.id, position: 'after' }
      );
      expect(response.ok).toBe(true);

      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [anchorRecord.id, anchorRecord.fields],
        ...batchRecords.map((record) => [record.id, record.fields] as const),
      ]);
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);
      const batchNames = batchPayload.map((record) => record.fields[testTextFieldId] as string);

      expect(names[names.length - batchCount - 1]).toBe('Anchor');
      expect(names.slice(-batchCount)).toEqual(batchNames);
    });
  });

  describe('createRecords with order', () => {
    it('should insert multiple records before anchor with distributed order values', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Batch Before Anchor Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create initial records A, B
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });

      // Create records C, D, E before B
      const newRecords = await createRecords(
        testTableId,
        [
          { fields: { [testTextFieldId]: 'C' } },
          { fields: { [testTextFieldId]: 'D' } },
          { fields: { [testTextFieldId]: 'E' } },
        ],
        { viewId: testViewId, anchorId: recordB.id, position: 'before' }
      );

      expect(newRecords.length).toBe(3);

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        ...newRecords.map((r) => [r.id, r.fields] as const),
      ]);

      // Verify order: A, C, D, E, B
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);

      const indexA = names.indexOf('A');
      const indexC = names.indexOf('C');
      const indexD = names.indexOf('D');
      const indexE = names.indexOf('E');
      const indexB = names.indexOf('B');

      expect(indexA).toBeLessThan(indexC);
      expect(indexC).toBeLessThan(indexD);
      expect(indexD).toBeLessThan(indexE);
      expect(indexE).toBeLessThan(indexB);
    });

    it('should insert multiple records after anchor with distributed order values', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Batch After Anchor Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create initial records A, B
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });

      // Create records C, D, E after A
      const newRecords = await createRecords(
        testTableId,
        [
          { fields: { [testTextFieldId]: 'C' } },
          { fields: { [testTextFieldId]: 'D' } },
          { fields: { [testTextFieldId]: 'E' } },
        ],
        { viewId: testViewId, anchorId: recordA.id, position: 'after' }
      );

      expect(newRecords.length).toBe(3);

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        ...newRecords.map((r) => [r.id, r.fields] as const),
      ]);

      // Verify order: A, C, D, E, B
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);

      const indexA = names.indexOf('A');
      const indexC = names.indexOf('C');
      const indexD = names.indexOf('D');
      const indexE = names.indexOf('E');
      const indexB = names.indexOf('B');

      expect(indexA).toBeLessThan(indexC);
      expect(indexC).toBeLessThan(indexD);
      expect(indexD).toBeLessThan(indexE);
      expect(indexE).toBeLessThan(indexB);
    });
  });

  describe('duplicateRecord with order', () => {
    it('should duplicate record and position before anchor', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Duplicate Before Anchor Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create initial records A, B, C
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'Original' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });
      const recordC = await createRecord(testTableId, { [testTextFieldId]: 'C' });

      // Duplicate A and position before C
      const duplicatedRecord = await duplicateRecord(testTableId, recordA.id, {
        viewId: testViewId,
        anchorId: recordC.id,
        position: 'before',
      });

      expect(duplicatedRecord.id).toMatch(/^rec/);
      expect(duplicatedRecord.id).not.toBe(recordA.id);

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        [recordC.id, recordC.fields],
        [duplicatedRecord.id, duplicatedRecord.fields],
      ]);

      // Verify order: Original (A), B, Duplicate, C
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );

      // Find the duplicate (should have same name as Original)
      const originalRecords = orderedRecords.filter((r) => r.name === 'Original');
      expect(originalRecords.length).toBe(2); // Original and duplicate

      const names = orderedRecords.map((r) => r.name);
      const indexB = names.indexOf('B');
      const indexC = names.indexOf('C');

      // The duplicate should be between B and C
      const duplicateIndex = orderedRecords.findIndex((r) => r.id === duplicatedRecord.id);
      expect(duplicateIndex).toBeGreaterThan(indexB);
      expect(duplicateIndex).toBeLessThan(indexC);
    });

    it('should duplicate record and position after anchor', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Duplicate After Anchor Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create initial records A, B, C
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'Original' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });
      const recordC = await createRecord(testTableId, { [testTextFieldId]: 'C' });

      // Duplicate A and position after A
      const duplicatedRecord = await duplicateRecord(testTableId, recordA.id, {
        viewId: testViewId,
        anchorId: recordA.id,
        position: 'after',
      });

      expect(duplicatedRecord.id).toMatch(/^rec/);
      expect(duplicatedRecord.id).not.toBe(recordA.id);

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        [recordC.id, recordC.fields],
        [duplicatedRecord.id, duplicatedRecord.fields],
      ]);

      // Verify order: Original (A), Duplicate, B, C
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );

      const names = orderedRecords.map((r) => r.name);
      const indexB = names.indexOf('B');

      // The duplicate should be between Original and B
      const originalIndex = orderedRecords.findIndex((r) => r.id === recordA.id);
      const duplicateIndex = orderedRecords.findIndex((r) => r.id === duplicatedRecord.id);

      expect(originalIndex).toBeLessThan(duplicateIndex);
      expect(duplicateIndex).toBeLessThan(indexB);
    });
  });

  describe('edge cases', () => {
    it('should handle ordering at first position (before first record)', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'First Position Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create record A
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });

      // Create B before A (at first position)
      const recordB = await createRecord(
        testTableId,
        { [testTextFieldId]: 'B' },
        { viewId: testViewId, anchorId: recordA.id, position: 'before' }
      );

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
      ]);

      // Verify order: B, A
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);

      expect(names[0]).toBe('B');
      expect(names[1]).toBe('A');
    });

    it('should handle ordering at last position (after last record)', async () => {
      const testTable = await createTable({
        baseId: ctx.baseId,
        name: 'Last Position Test',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const testTableId = testTable.id;
      const testViewId = testTable.views[0].id;
      const testTextFieldId = testTable.fields.find((f) => f.name === 'Name')?.id ?? '';

      // Create records A, B
      const recordA = await createRecord(testTableId, { [testTextFieldId]: 'A' });
      const recordB = await createRecord(testTableId, { [testTextFieldId]: 'B' });

      // Create C after B (at last position)
      const recordC = await createRecord(
        testTableId,
        { [testTextFieldId]: 'C' },
        { viewId: testViewId, anchorId: recordB.id, position: 'after' }
      );

      // Build a map of record IDs to field values
      const recordFieldMap = new Map<string, Record<string, unknown>>([
        [recordA.id, recordA.fields],
        [recordB.id, recordB.fields],
        [recordC.id, recordC.fields],
      ]);

      // Verify order: A, B, C
      const orderedRecords = await getOrderedRecordInfo(
        testTableId,
        testViewId,
        recordFieldMap,
        testTextFieldId
      );
      const names = orderedRecords.map((r) => r.name);

      expect(names).toEqual(['A', 'B', 'C']);
    });
  });
});
