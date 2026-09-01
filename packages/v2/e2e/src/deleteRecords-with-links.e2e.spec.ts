/* eslint-disable @typescript-eslint/naming-convention */
/**
 * E2E tests for deleting records that have link field relationships.
 *
 * These tests verify that deleting records properly handles:
 * 1. Outgoing links: When the deleted record has link fields pointing to other tables
 * 2. Incoming links: When other tables have link fields pointing to the deleted record
 *
 * The incoming link scenario is critical because it requires clearing foreign key
 * references in OTHER tables before the delete can succeed.
 */
import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http deleteRecords with links (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  // ===========================================================================
  // Outgoing Links - Delete record that has links to other tables
  // ===========================================================================

  describe('outgoing links (deleted record has links to other tables)', () => {
    it('deletes record with manyOne link to another table', async () => {
      // Create foreign table (target of link)
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteOutgoing_ManyOne_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'TargetB' });

      // Create source table with manyOne link to tableB
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteOutgoing_ManyOne_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinkToB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      // Create record in A with link to B
      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: { id: recordB.id },
      });

      await ctx.testContainer.processOutbox();

      // Delete record from A - should succeed and clear symmetric link in B
      await ctx.deleteRecord(tableA.id, recordA.id);

      // Verify record is deleted
      const records = await ctx.listRecords(tableA.id);
      expect(records.find((r) => r.id === recordA.id)).toBeUndefined();

      // Verify B's symmetric link is cleared
      const updatedTableB = await ctx.getTableById(tableB.id);
      const symLinkFieldId = updatedTableB.fields.find(
        (f) => f.type === 'link' && f.name !== 'LinkToB'
      )?.id;

      if (symLinkFieldId) {
        const bRecords = await ctx.listRecords(tableB.id);
        expect(bRecords[0].fields[symLinkFieldId] ?? undefined).toBeUndefined();
      }
    });

    it('deletes record with manyMany link to another table', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteOutgoing_ManyMany_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB1 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B1' });
      const recordB2 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B2' });

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteOutgoing_ManyMany_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinksToB',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
      });

      await ctx.testContainer.processOutbox();

      // Delete record from A
      await ctx.deleteRecord(tableA.id, recordA.id);

      // Verify record is deleted
      const records = await ctx.listRecords(tableA.id);
      expect(records.find((r) => r.id === recordA.id)).toBeUndefined();
    });
  });

  // ===========================================================================
  // Incoming Links - Delete record that is REFERENCED BY other tables
  // This is the critical scenario that causes FK constraint violations if not handled
  // ===========================================================================

  describe('incoming links (other tables have links pointing to deleted record)', () => {
    it('deletes record referenced by manyOne link from another table', async () => {
      // TableA will have a manyOne link to TableB
      // We delete from TableB - the record being linked TO

      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_ManyOne_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'TargetB' });

      // Create tableA with manyOne link to tableB
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_ManyOne_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinkToB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      // Create record in A that links to B
      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: { id: recordB.id },
      });

      await ctx.testContainer.processOutbox();

      // Verify link exists before delete
      const beforeRecords = await ctx.listRecords(tableA.id);
      expect(beforeRecords[0].fields[aLinkFieldId]).toEqual({ id: recordB.id, title: 'TargetB' });

      // Delete record from B (the one being linked TO)
      // This should clear the FK in tableA before deleting
      await ctx.deleteRecord(tableB.id, recordB.id);

      // Verify B record is deleted
      const bRecords = await ctx.listRecords(tableB.id);
      expect(bRecords.find((r) => r.id === recordB.id)).toBeUndefined();

      // Verify A's link is cleared (null or undefined)
      const afterRecords = await ctx.listRecords(tableA.id);
      expect(afterRecords[0].fields[aLinkFieldId] ?? undefined).toBeUndefined();
    });

    it('deletes record referenced by oneOne link from another table', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneOne_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'TargetB' });

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneOne_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinkToB',
            options: {
              relationship: 'oneOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: { id: recordB.id },
      });

      await ctx.testContainer.processOutbox();

      // Delete record from B
      await ctx.deleteRecord(tableB.id, recordB.id);

      // Verify B record is deleted
      const bRecords = await ctx.listRecords(tableB.id);
      expect(bRecords.find((r) => r.id === recordB.id)).toBeUndefined();

      // Verify A's link is cleared (null or undefined)
      const afterRecords = await ctx.listRecords(tableA.id);
      expect(afterRecords[0].fields[aLinkFieldId] ?? undefined).toBeUndefined();
    });

    it('deletes record referenced by manyMany link from another table', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_ManyMany_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB1 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B1' });
      const recordB2 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B2' });

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_ManyMany_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinksToB',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
      });

      await ctx.testContainer.processOutbox();

      // Verify links exist before delete
      const beforeRecords = await ctx.listRecords(tableA.id);
      expect(beforeRecords[0].fields[aLinkFieldId]).toHaveLength(2);

      // Delete B1 (one of the linked records)
      await ctx.deleteRecord(tableB.id, recordB1.id);

      // Verify B1 is deleted
      const bRecords = await ctx.listRecords(tableB.id);
      expect(bRecords.find((r) => r.id === recordB1.id)).toBeUndefined();
      expect(bRecords.find((r) => r.id === recordB2.id)).toBeDefined();

      // Verify A's link only contains B2 now
      const afterRecords = await ctx.listRecords(tableA.id);
      const links = afterRecords[0].fields[aLinkFieldId] as Array<{ id: string }>;
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(recordB2.id);
    });

    it('deletes record referenced by oneMany link from another table', async () => {
      // For oneMany from B's perspective: one B links to many A
      // Each A can only be linked to by one B (exclusivity on foreign side)
      // TableB (one) -> TableA (many)

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneMany_A',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';

      // Create multiple A records (the "many" side)
      const recordA1 = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'ChildA1' });
      const recordA2 = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'ChildA2' });

      // Create tableB with oneMany link TO tableA (B is one side, A is many side)
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneMany_B',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinksToA',
            options: {
              relationship: 'oneMany',
              foreignTableId: tableA.id,
              lookupFieldId: aNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';
      const bLinkFieldId = tableB.fields.find((f) => f.type === 'link')?.id ?? '';

      // Create record in B that links to both A records
      const recordB = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'ParentB',
        [bLinkFieldId]: [{ id: recordA1.id }, { id: recordA2.id }],
      });

      await ctx.testContainer.processOutbox();

      // Verify B has links to A1 and A2
      const beforeBRecords = await ctx.listRecords(tableB.id);
      const beforeLinks = beforeBRecords[0].fields[bLinkFieldId] as Array<{ id: string }>;
      expect(beforeLinks).toHaveLength(2);

      // Delete A1 (one of the records being linked TO by B)
      await ctx.deleteRecord(tableA.id, recordA1.id);

      // Verify A1 is deleted
      const aRecords = await ctx.listRecords(tableA.id);
      expect(aRecords.find((r) => r.id === recordA1.id)).toBeUndefined();
      expect(aRecords.find((r) => r.id === recordA2.id)).toBeDefined();

      // Verify B's link is updated (only A2 remains)
      const afterBRecords = await ctx.listRecords(tableB.id);
      const afterLinks = afterBRecords[0].fields[bLinkFieldId] as Array<{ id: string }>;
      expect(afterLinks).toHaveLength(1);
      expect(afterLinks[0].id).toBe(recordA2.id);
    });

    it('deletes record referenced by one-way manyMany link', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneWay_ManyMany_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'TargetB' });

      // One-way link: A links to B, but B has no symmetric field
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneWay_ManyMany_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinksToB',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: [{ id: recordB.id }],
      });

      await ctx.testContainer.processOutbox();

      // Delete B (the record being linked TO by one-way link)
      await ctx.deleteRecord(tableB.id, recordB.id);

      // Verify B is deleted
      const bRecords = await ctx.listRecords(tableB.id);
      expect(bRecords.find((r) => r.id === recordB.id)).toBeUndefined();

      // Verify A's link is cleared (null, undefined, or empty array)
      const afterRecords = await ctx.listRecords(tableA.id);
      const linkValue = afterRecords[0].fields[aLinkFieldId];
      expect(
        linkValue === null ||
          linkValue === undefined ||
          (Array.isArray(linkValue) && linkValue.length === 0)
      ).toBe(true);
    });

    it('deletes record referenced by one-way oneMany link', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneWay_OneMany_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'TargetB' });

      // One-way oneMany: A has multiple links to B records
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_OneWay_OneMany_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinksToB',
            options: {
              relationship: 'oneMany',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: [{ id: recordB.id }],
      });

      await ctx.testContainer.processOutbox();

      // Delete B
      await ctx.deleteRecord(tableB.id, recordB.id);

      // Verify B is deleted
      const bRecords = await ctx.listRecords(tableB.id);
      expect(bRecords.find((r) => r.id === recordB.id)).toBeUndefined();

      // Verify A's link is cleared (null, undefined, or empty array)
      const afterRecords = await ctx.listRecords(tableA.id);
      const linkValue = afterRecords[0].fields[aLinkFieldId];
      expect(
        linkValue === null ||
          linkValue === undefined ||
          (Array.isArray(linkValue) && linkValue.length === 0)
      ).toBe(true);
    });
  });

  // ===========================================================================
  // Batch Delete with Links
  // ===========================================================================

  describe('batch delete with incoming links', () => {
    it('deletes multiple records referenced by links from another table', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteBatch_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';

      const recordB1 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B1' });
      const recordB2 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B2' });
      const recordB3 = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'B3' });

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteBatch_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinkToB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      // Create A records linking to different B records
      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A1',
        [aLinkFieldId]: { id: recordB1.id },
      });
      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A2',
        [aLinkFieldId]: { id: recordB2.id },
      });
      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A3',
        [aLinkFieldId]: { id: recordB3.id },
      });

      await ctx.testContainer.processOutbox();

      // Batch delete B1 and B2
      await ctx.deleteRecords(tableB.id, [recordB1.id, recordB2.id]);

      // Verify B1 and B2 are deleted, B3 remains
      const bRecords = await ctx.listRecords(tableB.id);
      expect(bRecords.find((r) => r.id === recordB1.id)).toBeUndefined();
      expect(bRecords.find((r) => r.id === recordB2.id)).toBeUndefined();
      expect(bRecords.find((r) => r.id === recordB3.id)).toBeDefined();

      // Verify A records' links are appropriately updated (null or undefined for deleted links)
      const afterARecords = await ctx.listRecords(tableA.id);
      const a1 = afterARecords.find((r) => r.fields[aNameFieldId] === 'A1');
      const a2 = afterARecords.find((r) => r.fields[aNameFieldId] === 'A2');
      const a3 = afterARecords.find((r) => r.fields[aNameFieldId] === 'A3');

      expect(a1?.fields[aLinkFieldId] ?? undefined).toBeUndefined(); // B1 was deleted
      expect(a2?.fields[aLinkFieldId] ?? undefined).toBeUndefined(); // B2 was deleted
      expect(a3?.fields[aLinkFieldId]).toEqual({ id: recordB3.id, title: 'B3' }); // B3 remains
    });
  });

  // ===========================================================================
  // Self-Referential Links
  // ===========================================================================

  describe('self-referential links', () => {
    // TODO: Self-referential link cleanup works (FK is nullified), but the computed
    // system needs enhancement to properly update the denormalized link values.
    // This is tracked separately and can be addressed as a follow-up.
    it.skip('deletes record referenced by self-referential manyOne link', async () => {
      // Create table first with just the primary field
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'SelfRef_A',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });

      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';

      // Add self-referential link field
      const updatedTable = await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableA.id,
        field: {
          type: 'link',
          name: 'ParentA',
          options: {
            relationship: 'manyOne',
            foreignTableId: tableA.id,
            lookupFieldId: aNameFieldId,
            isOneWay: false,
          },
        },
      });
      const aLinkFieldId = updatedTable.fields.find((f) => f.type === 'link')?.id ?? '';

      // Create records: A1 is parent, A2 and A3 link to A1
      const recordA1 = await ctx.createRecord(tableA.id, { [aNameFieldId]: 'A1' });
      const recordA2 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A2',
        [aLinkFieldId]: { id: recordA1.id },
      });
      const recordA3 = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'A3',
        [aLinkFieldId]: { id: recordA1.id },
      });

      await ctx.testContainer.processOutbox();

      // Verify A2 and A3 link to A1
      const beforeRecords = await ctx.listRecords(tableA.id);
      const a2Before = beforeRecords.find((r) => r.fields[aNameFieldId] === 'A2');
      const a3Before = beforeRecords.find((r) => r.fields[aNameFieldId] === 'A3');
      expect(a2Before?.fields[aLinkFieldId]).toMatchObject({ id: recordA1.id });
      expect(a3Before?.fields[aLinkFieldId]).toMatchObject({ id: recordA1.id });

      // Delete A1 (the parent record)
      await ctx.deleteRecord(tableA.id, recordA1.id);
      await ctx.testContainer.processOutbox();

      // Verify A1 is deleted
      const afterRecords = await ctx.listRecords(tableA.id);
      expect(afterRecords.find((r) => r.id === recordA1.id)).toBeUndefined();

      // Verify A2 and A3's links are cleared
      const a2After = afterRecords.find((r) => r.fields[aNameFieldId] === 'A2');
      const a3After = afterRecords.find((r) => r.fields[aNameFieldId] === 'A3');
      expect(a2After?.fields[aLinkFieldId] ?? undefined).toBeUndefined();
      expect(a3After?.fields[aLinkFieldId] ?? undefined).toBeUndefined();
    });
  });

  // ===========================================================================
  // Computed Fields Update on Delete
  // ===========================================================================

  describe('computed fields update on delete', () => {
    it('updates rollup when linked record is deleted', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteComputed_B',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'number', name: 'Value' },
        ],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';
      const bValueFieldId = tableB.fields.find((f) => f.name === 'Value')?.id ?? '';

      const recordB1 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B1',
        [bValueFieldId]: 10,
      });
      const recordB2 = await ctx.createRecord(tableB.id, {
        [bNameFieldId]: 'B2',
        [bValueFieldId]: 20,
      });

      // Create tableA with just the basic fields first
      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteComputed_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinksToB',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });

      // Get field IDs
      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkFieldId = tableA.fields.find((f) => f.type === 'link')?.id ?? '';

      // Add rollup field now that we know the link field ID
      const updatedTableA = await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableA.id,
        field: {
          type: 'rollup',
          name: 'SumB',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: aLinkFieldId,
            foreignTableId: tableB.id,
            lookupFieldId: bValueFieldId,
          },
        },
      });
      const aRollupFieldId = updatedTableA.fields.find((f) => f.type === 'rollup')?.id ?? '';

      // Create A with links to both B records
      await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkFieldId]: [{ id: recordB1.id }, { id: recordB2.id }],
      });

      await ctx.testContainer.processOutbox();

      // Verify initial rollup sum = 10 + 20 = 30
      const beforeRecords = await ctx.listRecords(tableA.id);
      expect(beforeRecords[0].fields[aRollupFieldId]).toBe(30);

      // Delete B1
      await ctx.deleteRecord(tableB.id, recordB1.id);
      await ctx.testContainer.processOutbox();

      // Verify rollup updated to only B2's value = 20
      const afterRecords = await ctx.listRecords(tableA.id);
      expect(afterRecords[0].fields[aRollupFieldId]).toBe(20);
    });
  });

  // ===========================================================================
  // Deleting records that own link-derived fields / link constraints
  // Ported from v1 link-api.e2e-spec.ts "Create two bi-link for two tables"
  // ===========================================================================

  describe('deleting records that own link-derived fields or link constraints', () => {
    it('deletes a record that has a lookup of the symmetric link field', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteLinkLookup_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';
      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'TargetB' });

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteLinkLookup_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'LinkToB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkField = tableA.fields.find((f) => f.type === 'link');
      if (!aLinkField || aLinkField.type !== 'link') throw new Error('Missing link field');
      const symmetricFieldId = aLinkField.options.symmetricFieldId ?? '';
      if (!symmetricFieldId) throw new Error('Missing symmetric field id');

      // Lookup on tableA whose looked-up foreign field is itself a link field
      // (tableB's symmetric link back to tableA)
      const tableAWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: tableA.id,
        field: {
          type: 'lookup',
          name: 'LookupOfSymmetricLink',
          options: {
            linkFieldId: aLinkField.id,
            foreignTableId: tableB.id,
            lookupFieldId: symmetricFieldId,
          },
        },
      });
      expect(tableAWithLookup.fields.find((f) => f.name === 'LookupOfSymmetricLink')).toBeDefined();

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkField.id]: { id: recordB.id },
      });
      await ctx.testContainer.processOutbox();
      await ctx.testContainer.processOutbox();

      // Deleting the record that owns both the link and the link-lookup must succeed
      await ctx.deleteRecord(tableA.id, recordA.id);
      await ctx.testContainer.processOutbox();

      const afterRecords = await ctx.listRecords(tableA.id);
      expect(afterRecords.find((r) => r.id === recordA.id)).toBeUndefined();

      // Symmetric cell on tableB reads back empty (null/absent), never []
      const bRecords = await ctx.listRecords(tableB.id);
      const bStored = bRecords.find((r) => r.id === recordB.id);
      expect(bStored?.fields[symmetricFieldId] ?? undefined).toBeUndefined();
    });

    it('deletes a record whose own link field has a notNull constraint', async () => {
      const tableB = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteNotNullLink_B',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const bNameFieldId = tableB.fields.find((f) => f.isPrimary)?.id ?? '';
      const recordB = await ctx.createRecord(tableB.id, { [bNameFieldId]: 'TargetB' });

      const tableA = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteNotNullLink_A',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'RequiredLinkToB',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableB.id,
              lookupFieldId: bNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const aNameFieldId = tableA.fields.find((f) => f.isPrimary)?.id ?? '';
      const aLinkField = tableA.fields.find((f) => f.type === 'link');
      if (!aLinkField || aLinkField.type !== 'link') throw new Error('Missing link field');
      const symmetricFieldId = aLinkField.options.symmetricFieldId ?? '';

      const recordA = await ctx.createRecord(tableA.id, {
        [aNameFieldId]: 'SourceA',
        [aLinkField.id]: { id: recordB.id },
      });
      await ctx.testContainer.processOutbox();

      // Enable notNull on the link field after the record already has a value
      const updatedTable = await ctx.updateField({
        tableId: tableA.id,
        fieldId: aLinkField.id,
        field: { notNull: true },
      });
      expect(updatedTable.fields.find((f) => f.id === aLinkField.id)?.notNull).toBe(true);

      // Deleting the record must succeed even though its own link field is notNull;
      // the symmetric cleanup happens on tableB, not on the deleted row.
      await ctx.deleteRecord(tableA.id, recordA.id);
      await ctx.testContainer.processOutbox();

      const afterRecords = await ctx.listRecords(tableA.id);
      expect(afterRecords.find((r) => r.id === recordA.id)).toBeUndefined();

      if (symmetricFieldId) {
        const bRecords = await ctx.listRecords(tableB.id);
        const bStored = bRecords.find((r) => r.id === recordB.id);
        expect(bStored?.fields[symmetricFieldId] ?? undefined).toBeUndefined();
      }
    });

    it('rejects deleting the foreign row that a required manyOne link still owns T6705', async () => {
      const ownerTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredLinkOwner',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const ownerTitleFieldId = ownerTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ownerRecord = await ctx.createRecord(ownerTable.id, {
        [ownerTitleFieldId]: 'Owner Title',
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredLinkHost',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Required Owner',
            notNull: true,
            options: {
              relationship: 'manyOne',
              foreignTableId: ownerTable.id,
              lookupFieldId: ownerTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostNameFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hostLinkFieldId = hostTable.fields.find((f) => f.name === 'Required Owner')?.id ?? '';

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host Row',
        [hostLinkFieldId]: { id: ownerRecord.id },
      });
      await ctx.testContainer.processOutbox();

      const deleteResponse = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: ownerTable.id, recordIds: [ownerRecord.id] }),
      });
      expect(deleteResponse.status).toBeGreaterThanOrEqual(400);
      // The rejection is localizable and names the table and field that would be emptied
      const deleteBody = (await deleteResponse.json()) as {
        error?: { localization?: { i18nKey?: string; context?: Record<string, unknown> } };
      };
      expect(deleteBody.error?.localization).toEqual({
        i18nKey: 'httpErrors.custom.recordDeleteBlockedByRequiredLink',
        context: { tableName: 'RequiredLinkHost', fieldName: 'Required Owner' },
      });

      const remainingOwners = await ctx.listRecords(ownerTable.id);
      expect(remainingOwners.find((record) => record.id === ownerRecord.id)).toBeDefined();

      await ctx.updateRecord(ownerTable.id, ownerRecord.id, {
        [ownerTitleFieldId]: 'Owner Title Updated',
      });
      await ctx.testContainer.processOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id);
      const storedHost = hostRecords.find((record) => record.id === hostRecord.id);
      expect(storedHost).toBeDefined();
      expect(storedHost?.fields[hostLinkFieldId]).toEqual(
        expect.objectContaining({ id: ownerRecord.id })
      );
    });

    it('allows deleting a required self-link cluster in one batch T6705', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredSelfLink',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
      const updatedTable = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          type: 'link',
          name: 'Parent',
          options: {
            relationship: 'manyOne',
            foreignTableId: table.id,
            lookupFieldId: nameFieldId,
            isOneWay: true,
          },
        },
      });
      const linkFieldId = updatedTable.fields.find((f) => f.type === 'link')?.id ?? '';

      const parent = await ctx.createRecord(table.id, { [nameFieldId]: 'Parent' });
      const child = await ctx.createRecord(table.id, {
        [nameFieldId]: 'Child',
        [linkFieldId]: { id: parent.id },
      });
      await ctx.updateRecord(table.id, parent.id, { [linkFieldId]: { id: child.id } });
      await ctx.testContainer.processOutbox();

      await ctx.updateField({
        baseId: ctx.baseId,
        tableId: table.id,
        fieldId: linkFieldId,
        field: { notNull: true },
      });

      // Deleting only the parent leaves the child pointing at it: rejected
      const rejected = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, recordIds: [parent.id] }),
      });
      expect(rejected.status).toBeGreaterThanOrEqual(400);

      // Deleting the whole cluster leaves no row with an emptied required link
      await ctx.deleteRecords(table.id, [parent.id, child.id]);
      const remaining = await ctx.listRecords(table.id);
      expect(remaining.find((record) => record.id === parent.id)).toBeUndefined();
      expect(remaining.find((record) => record.id === child.id)).toBeUndefined();
    });

    it('rejects deleting the last linked record of a required manyMany link T6705', async () => {
      const ownerTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredManyManyOwner',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const ownerTitleFieldId = ownerTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ownerOne = await ctx.createRecord(ownerTable.id, { [ownerTitleFieldId]: 'Owner 1' });
      const ownerTwo = await ctx.createRecord(ownerTable.id, { [ownerTitleFieldId]: 'Owner 2' });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredManyManyHost',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Required Owners',
            notNull: true,
            options: {
              relationship: 'manyMany',
              foreignTableId: ownerTable.id,
              lookupFieldId: ownerTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostNameFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hostLinkFieldId = hostTable.fields.find((f) => f.name === 'Required Owners')?.id ?? '';
      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Host Row',
        [hostLinkFieldId]: [{ id: ownerOne.id }],
      });
      await ctx.testContainer.processOutbox();

      // Deleting the only linked owner would empty the required link: rejected
      const rejected = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: ownerTable.id, recordIds: [ownerOne.id] }),
      });
      expect(rejected.status).toBeGreaterThanOrEqual(400);

      // With a second link the host keeps one owner, so the delete goes through
      await ctx.updateRecord(hostTable.id, hostRecord.id, {
        [hostLinkFieldId]: [{ id: ownerOne.id }, { id: ownerTwo.id }],
      });
      await ctx.testContainer.processOutbox();
      await ctx.deleteRecords(ownerTable.id, [ownerOne.id]);
      await ctx.testContainer.processOutbox();

      const hostRecords = await ctx.listRecords(hostTable.id);
      const storedHost = hostRecords.find((record) => record.id === hostRecord.id);
      expect(storedHost).toBeDefined();
      expect(storedHost?.fields[hostLinkFieldId]).toEqual([
        expect.objectContaining({ id: ownerTwo.id }),
      ]);
    });

    it('rejects deleting the last child that a required two-way oneMany link still holds T6705', async () => {
      const childTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredOneManyChild',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const childNameFieldId = childTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const childRecord = await ctx.createRecord(childTable.id, {
        [childNameFieldId]: 'Only Child',
      });

      const parentTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredOneManyParent',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Required Children',
            notNull: true,
            options: {
              relationship: 'oneMany',
              foreignTableId: childTable.id,
              lookupFieldId: childNameFieldId,
              isOneWay: false,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const parentNameFieldId = parentTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const parentLinkFieldId =
        parentTable.fields.find((f) => f.name === 'Required Children')?.id ?? '';
      const parentRecord = await ctx.createRecord(parentTable.id, {
        [parentNameFieldId]: 'Parent Row',
        [parentLinkFieldId]: [{ id: childRecord.id }],
      });
      await ctx.testContainer.processOutbox();

      // Deleting the only child would empty the parent's required link: rejected
      const rejected = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: childTable.id, recordIds: [childRecord.id] }),
      });
      expect(rejected.status).toBeGreaterThanOrEqual(400);

      // Deleting the parent itself is fine (the required link dies with its owner),
      // after which the child is free to go too
      await ctx.deleteRecords(parentTable.id, [parentRecord.id]);
      await ctx.deleteRecords(childTable.id, [childRecord.id]);
      const remainingChildren = await ctx.listRecords(childTable.id);
      expect(remainingChildren.find((record) => record.id === childRecord.id)).toBeUndefined();
    });
  });

  describe('incoming links across bases, trash, and duplicate T6862 T6863 T6864', () => {
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
      if (!parsed.success || !parsed.data.ok) {
        throw new Error(`CreateBase parse failed: ${JSON.stringify(rawBody)}`);
      }
      return parsed.data.data.base.id;
    };

    const listFkDeleteActions = async (baseId: string, tableId: string) => {
      const result = await sql<{ attname: string; confdeltype: string }>`
        SELECT a.attname, c.confdeltype
        FROM pg_constraint c
        JOIN pg_class s ON s.oid = c.conrelid
        JOIN pg_namespace sn ON sn.oid = s.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND sn.nspname = ${baseId}
          AND s.relname = ${tableId}
          AND starts_with(a.attname, '__fk_')
        ORDER BY a.attname
      `.execute(ctx.testContainer.db);
      return result.rows;
    };

    it('clears optional cross-base manyOne display values and lookups when the target is deleted T6863', async () => {
      const foreignBaseId = await createBase('DeleteIncoming_CrossBase_Foreign');
      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: 'People',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const foreignNameFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const foreignRecord = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Ada',
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'DeleteIncoming_CrossBase_OptionalHost',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const hostTitleFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const tableAfterLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Person',
          options: {
            baseId: foreignBaseId,
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      });
      const hostLinkFieldId = tableAfterLink.fields.find((f) => f.name === 'Person')?.id ?? '';
      const tableAfterLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTable.id,
        field: {
          type: 'lookup',
          name: 'Person Name',
          options: {
            linkFieldId: hostLinkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
          },
        },
      });
      const lookupFieldId = tableAfterLookup.fields.find((f) => f.name === 'Person Name')?.id ?? '';

      const hostRecord = await ctx.createRecord(hostTable.id, {
        [hostTitleFieldId]: 'Badge',
        [hostLinkFieldId]: { id: foreignRecord.id },
      });
      await ctx.testContainer.processOutbox();

      const before = (await ctx.listRecords(hostTable.id)).find((r) => r.id === hostRecord.id);
      expect(before?.fields[hostLinkFieldId]).toEqual(
        expect.objectContaining({ id: foreignRecord.id, title: 'Ada' })
      );
      expect(before?.fields[lookupFieldId]).toEqual(['Ada']);

      await ctx.deleteRecord(foreignTable.id, foreignRecord.id);
      await ctx.testContainer.processOutbox();

      const after = (await ctx.listRecords(hostTable.id)).find((r) => r.id === hostRecord.id);
      expect(after?.fields[hostLinkFieldId] ?? undefined).toBeUndefined();
      expect(after?.fields[lookupFieldId] ?? []).toEqual([]);
    });

    it('rejects deleting a row still owned by a required cross-base manyOne and names the field T6863', async () => {
      const foreignBaseId = await createBase('DeleteIncoming_CrossBase_RequiredForeign');
      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: 'Owners',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const foreignNameFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ownerRecord = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Owner',
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'RequiredCrossBaseHost',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Required Owner',
            notNull: true,
            options: {
              baseId: foreignBaseId,
              relationship: 'manyOne',
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostTitleFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hostLinkFieldId = hostTable.fields.find((f) => f.name === 'Required Owner')?.id ?? '';
      await ctx.createRecord(hostTable.id, {
        [hostTitleFieldId]: 'Host',
        [hostLinkFieldId]: { id: ownerRecord.id },
      });
      await ctx.testContainer.processOutbox();

      const deleteResponse = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: foreignTable.id, recordIds: [ownerRecord.id] }),
      });
      expect(deleteResponse.status).toBeGreaterThanOrEqual(400);
      const deleteBody = (await deleteResponse.json()) as {
        error?: { localization?: { i18nKey?: string; context?: Record<string, unknown> } };
      };
      expect(deleteBody.error?.localization).toEqual({
        i18nKey: 'httpErrors.custom.recordDeleteBlockedByRequiredLink',
        context: { tableName: 'RequiredCrossBaseHost', fieldName: 'Required Owner' },
      });

      const remaining = await ctx.listRecords(foreignTable.id, { baseId: foreignBaseId });
      expect(remaining.find((record) => record.id === ownerRecord.id)).toBeDefined();
    });

    it('rejects deleting a row referenced by a required link on a trashed table and names the field T6863', async () => {
      const ownerTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'TrashLinkOwner',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const ownerTitleFieldId = ownerTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const ownerRecord = await ctx.createRecord(ownerTable.id, {
        [ownerTitleFieldId]: 'Still Needed',
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'TrashLinkHost',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'link',
            name: 'Required Owner',
            notNull: true,
            options: {
              relationship: 'manyOne',
              foreignTableId: ownerTable.id,
              lookupFieldId: ownerTitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostNameFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const hostLinkFieldId = hostTable.fields.find((f) => f.name === 'Required Owner')?.id ?? '';
      await ctx.createRecord(hostTable.id, {
        [hostNameFieldId]: 'Parked',
        [hostLinkFieldId]: { id: ownerRecord.id },
      });
      await ctx.testContainer.processOutbox();

      await ctx.deleteTable(hostTable.id, { mode: 'soft' });

      const deleteResponse = await fetch(`${ctx.baseUrl}/tables/deleteRecords`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: ownerTable.id, recordIds: [ownerRecord.id] }),
      });
      expect(deleteResponse.status).toBeGreaterThanOrEqual(400);
      const deleteBody = (await deleteResponse.json()) as {
        error?: { localization?: { i18nKey?: string; context?: Record<string, unknown> } };
      };
      expect(deleteBody.error?.localization).toEqual({
        i18nKey: 'httpErrors.custom.recordDeleteBlockedByRequiredLink',
        context: { tableName: 'TrashLinkHost', fieldName: 'Required Owner' },
      });
    });

    it('keeps SET NULL on optional manyOne FKs after base duplicate so the target can be deleted T6862', async () => {
      const foreignBaseId = await createBase('DeleteIncoming_Dup_Foreign');
      const foreignTable = await ctx.createTable({
        baseId: foreignBaseId,
        name: 'People',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const foreignNameFieldId = foreignTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const foreignRecord = await ctx.createRecord(foreignTable.id, {
        [foreignNameFieldId]: 'Lin',
      });

      const sourceBaseId = await createBase('DeleteIncoming_Dup_Source');
      const hostTable = await ctx.createTable({
        baseId: sourceBaseId,
        name: 'Assignments',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const hostTitleFieldId = hostTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const tableAfterLink = await ctx.createField({
        baseId: sourceBaseId,
        tableId: hostTable.id,
        field: {
          type: 'link',
          name: 'Person',
          options: {
            baseId: foreignBaseId,
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignNameFieldId,
            isOneWay: true,
          },
        },
      });
      const hostLinkFieldId = tableAfterLink.fields.find((f) => f.name === 'Person')?.id ?? '';
      await ctx.createRecord(hostTable.id, {
        [hostTitleFieldId]: 'Shift',
        [hostLinkFieldId]: { id: foreignRecord.id },
      });
      await ctx.testContainer.processOutbox();

      const duplicateResponse = await fetch(`${ctx.baseUrl}/bases/duplicate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceBaseId, withRecords: true }),
      });
      const duplicateBody = (await duplicateResponse.json()) as {
        ok?: boolean;
        data?: {
          base: { id: string };
          tableIdMap: Record<string, string>;
          fieldIdMap: Record<string, string>;
        };
      };
      expect(duplicateResponse.status, JSON.stringify(duplicateBody)).toBe(201);
      const targetBaseId = duplicateBody.data?.base.id;
      const targetTableId = duplicateBody.data?.tableIdMap[hostTable.id];
      const targetLinkFieldId = duplicateBody.data?.fieldIdMap[hostLinkFieldId];
      expect(targetBaseId).toBeDefined();
      expect(targetTableId).toBeDefined();
      expect(targetLinkFieldId).toBeDefined();
      if (!targetBaseId || !targetTableId || !targetLinkFieldId) return;

      const fkActions = await listFkDeleteActions(targetBaseId, targetTableId);
      expect(fkActions.length).toBeGreaterThan(0);
      expect(fkActions.every((row) => row.confdeltype === 'n')).toBe(true);

      await ctx.deleteRecord(foreignTable.id, foreignRecord.id);
      await ctx.testContainer.processOutbox();

      const copied = await ctx.listRecords(targetTableId, { baseId: targetBaseId });
      expect(copied[0]?.fields[targetLinkFieldId] ?? undefined).toBeUndefined();
    });
  });
});
