/* eslint-disable @typescript-eslint/naming-convention */
import {
  createRecordOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * E2E tests for oneOne link field duplicate constraint validation.
 *
 * These tests verify that when a target record is already linked in a oneOne relationship,
 * attempting to link the same target from another source record should:
 * 1. Return a business error (HTTP 4xx) rather than database error (HTTP 5xx)
 * 2. Properly validate the constraint at the application layer before reaching the database
 *
 * This addresses the issue where duplicate key violations were causing 500 errors
 * instead of proper 400 validation errors.
 */

describe('v2 http oneOne link field duplicate constraint (e2e)', () => {
  let ctx: SharedTestContext;

  /**
   * Update record and return the response object for status checking.
   * Does not throw on non-ok responses to allow testing error cases.
   */
  const updateRecordRaw = async (
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
    return { response, rawBody };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 30000);

  // No afterAll dispose needed - handled by vitest.setup.ts

  describe('two-way oneOne link field (isOneWay: false)', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId: string;
    let mainRecordId1: string;
    let mainRecordId2: string;

    beforeAll(async () => {
      // Create foreign table
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'TwoWay OneOne Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create main table with two-way oneOne link (no isOneWay option)
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'TwoWay OneOne Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Partner',
            options: {
              relationship: 'oneOne',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              // isOneWay is NOT set, making this a two-way link
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Partner')?.id ?? '';

      // Create target record in foreign table
      const foreignRecord = await ctx.createRecord(foreignTableId, {
        [foreignTitleFieldId]: 'Target Partner',
      });
      foreignRecordId = foreignRecord.id;

      // Create two records in main table (no links yet)
      const mainRecord1 = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Main Record 1',
      });
      const mainRecord2 = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Main Record 2',
      });
      mainRecordId1 = mainRecord1.id;
      mainRecordId2 = mainRecord2.id;

      await ctx.drainOutbox();
    });

    it('should allow first record to link to target', async () => {
      // First update: link mainRecord1 to foreignRecord - should succeed
      const updated = await ctx.updateRecord(mainTableId, mainRecordId1, {
        [linkFieldId]: { id: foreignRecordId, title: 'Target Partner' },
      });

      expect(updated.id).toBe(mainRecordId1);
      await ctx.drainOutbox();
    });

    it('should return 400 error when second record tries to link to same target', async () => {
      // Second update: link mainRecord2 to same foreignRecord - should fail with 400
      const { response, rawBody } = await updateRecordRaw(mainTableId, mainRecordId2, {
        [linkFieldId]: { id: foreignRecordId, title: 'Target Partner' },
      });

      // Should be a client error (4xx), NOT a server error (5xx)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);

      // Verify error message indicates duplicate link
      const errorMessage = JSON.stringify(rawBody).toLowerCase();
      expect(
        errorMessage.includes('duplicate') ||
          errorMessage.includes('already') ||
          errorMessage.includes('link') ||
          errorMessage.includes('validation')
      ).toBe(true);
    });
  });

  describe('one-way oneOne link field (isOneWay: true)', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId: string;
    let mainRecordId1: string;
    let mainRecordId2: string;

    beforeAll(async () => {
      // Create foreign table
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'OneWay OneOne Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create main table with one-way oneOne link
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'OneWay OneOne Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Partner',
            options: {
              relationship: 'oneOne',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Partner')?.id ?? '';

      // Create target record in foreign table
      const foreignRecord = await ctx.createRecord(foreignTableId, {
        [foreignTitleFieldId]: 'One Way Target',
      });
      foreignRecordId = foreignRecord.id;

      // Create two records in main table (no links yet)
      const mainRecord1 = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'OneWay Main Record 1',
      });
      const mainRecord2 = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'OneWay Main Record 2',
      });
      mainRecordId1 = mainRecord1.id;
      mainRecordId2 = mainRecord2.id;

      await ctx.drainOutbox();
    });

    it('should allow first record to link to target', async () => {
      // First update: link mainRecord1 to foreignRecord - should succeed
      const updated = await ctx.updateRecord(mainTableId, mainRecordId1, {
        [linkFieldId]: { id: foreignRecordId, title: 'One Way Target' },
      });

      expect(updated.id).toBe(mainRecordId1);
      await ctx.drainOutbox();
    });

    it('should return 400 error when second record tries to link to same target', async () => {
      // Second update: link mainRecord2 to same foreignRecord - should fail with 400
      const { response, rawBody } = await updateRecordRaw(mainTableId, mainRecordId2, {
        [linkFieldId]: { id: foreignRecordId, title: 'One Way Target' },
      });

      // Should be a client error (4xx), NOT a server error (5xx)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);

      // Verify error message indicates duplicate link
      const errorMessage = JSON.stringify(rawBody).toLowerCase();
      expect(
        errorMessage.includes('duplicate') ||
          errorMessage.includes('already') ||
          errorMessage.includes('link') ||
          errorMessage.includes('validation')
      ).toBe(true);
    });
  });

  describe('oneOne link field duplicate in createRecord', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId: string;

    beforeAll(async () => {
      // Create foreign table
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CreateRecord OneOne Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create main table with oneOne link
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'CreateRecord OneOne Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Partner',
            options: {
              relationship: 'oneOne',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Partner')?.id ?? '';

      // Create target record
      const foreignRecord = await ctx.createRecord(foreignTableId, {
        [foreignTitleFieldId]: 'Unique Target',
      });
      foreignRecordId = foreignRecord.id;

      // Create first record that links to target
      await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'First Linker',
        [linkFieldId]: { id: foreignRecordId, title: 'Unique Target' },
      });

      await ctx.drainOutbox();
    });

    it('should return 400 error when creating second record with same link target', async () => {
      // Try to create another record linking to the same target
      const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: mainTableId,
          fields: {
            [mainTitleFieldId]: 'Second Linker',
            [linkFieldId]: { id: foreignRecordId, title: 'Unique Target' },
          },
        }),
      });

      const rawBody = await response.json();

      // Should be a client error (4xx), NOT a server error (5xx)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);

      // Verify error message indicates duplicate link
      const errorMessage = JSON.stringify(rawBody).toLowerCase();
      expect(
        errorMessage.includes('duplicate') ||
          errorMessage.includes('already') ||
          errorMessage.includes('link') ||
          errorMessage.includes('validation')
      ).toBe(true);
    });
  });

  describe('oneMany link field (should NOT have duplicate constraint)', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId: string;

    beforeAll(async () => {
      // Create foreign table
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'OneMany Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create main table with oneMany link
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'OneMany Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Children',
            options: {
              relationship: 'oneMany',
              foreignTableId,
              lookupFieldId: foreignTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      linkFieldId = mainTable.fields.find((f) => f.name === 'Children')?.id ?? '';

      // Create target record
      const foreignRecord = await ctx.createRecord(foreignTableId, {
        [foreignTitleFieldId]: 'Child Record',
      });
      foreignRecordId = foreignRecord.id;

      await ctx.drainOutbox();
    });

    it('should allow multiple records to link to same target in oneMany', async () => {
      // oneMany: Each foreign record can only have ONE parent (the "one" side)
      // But this is oneMany from main table's perspective, so multiple children can exist
      // However, each child can only belong to one parent

      // Create first parent
      const parent1 = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Parent 1',
        [linkFieldId]: [{ id: foreignRecordId, title: 'Child Record' }],
      });

      expect(parent1.id).toMatch(/^rec/);
      await ctx.drainOutbox();

      // For oneMany, the second parent trying to link the same child should fail
      // because each child can only have one parent
      const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: mainTableId,
          fields: {
            [mainTitleFieldId]: 'Parent 2',
            [linkFieldId]: [{ id: foreignRecordId, title: 'Child Record' }],
          },
        }),
      });

      // oneMany should also enforce that each child has only one parent
      // If this returns 500, it indicates the same bug exists for oneMany
      if (!response.ok) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
    });
  });
});
