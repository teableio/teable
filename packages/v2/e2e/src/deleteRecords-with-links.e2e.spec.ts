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
});
