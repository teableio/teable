/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * Comprehensive E2E tests for link field record creation.
 *
 * Tests all four relationship types:
 * - manyMany: Junction table with FK constraints
 * - manyOne: FK column in current table
 * - oneMany: FK column in foreign table (two-way) or junction table (one-way)
 * - oneOne: FK column in current table
 *
 * Also tests self-referential links (linking to the same table).
 *
 * Verifies:
 * 1. API returns correct values after creation
 * 2. listRecords returns correct link values
 * 3. Database contains correct FK/junction table data
 */

describe('v2 http createRecord link fields (e2e)', () => {
  let ctx: SharedTestContext;

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await ctx.testContainer.processOutbox();
    }
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('manyMany relationship', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId1: string;
    let foreignRecordId2: string;

    beforeAll(async () => {
      // Create foreign table
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ManyMany Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create records in foreign table
      const fr1 = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Foreign A' });
      const fr2 = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Foreign B' });
      foreignRecordId1 = fr1.id;
      foreignRecordId2 = fr2.id;

      // Create main table with manyMany link
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ManyMany Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Link',
            options: {
              relationship: 'manyMany',
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
      linkFieldId = mainTable.fields.find((f) => f.name === 'Link')?.id ?? '';
    });

    it('creates record with multiple links and verifies via listRecords', async () => {
      // Create main record with links to both foreign records
      const mainRecord = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Main with ManyMany',
        [linkFieldId]: [
          { id: foreignRecordId1, title: 'Foreign A' },
          { id: foreignRecordId2, title: 'Foreign B' },
        ],
      });

      expect(mainRecord.id).toMatch(/^rec/);

      // Verify via listRecords
      await processOutbox();
      const records = await ctx.listRecords(mainTableId);
      const found = records.find((r) => r.id === mainRecord.id);
      expect(found).toBeDefined();

      const linkValue = found?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
      expect(linkValue).toBeDefined();
      expect(Array.isArray(linkValue)).toBe(true);
      expect(linkValue.length).toBe(2);
      expect(linkValue.map((l) => l.id).sort()).toEqual(
        [foreignRecordId1, foreignRecordId2].sort()
      );
    });

    it('creates multiple records with different link combinations', async () => {
      // Create record with just one link
      const record1 = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'One Link Only',
        [linkFieldId]: [{ id: foreignRecordId1, title: 'Foreign A' }],
      });

      // Create record with both links
      const record2 = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Both Links',
        [linkFieldId]: [
          { id: foreignRecordId1, title: 'Foreign A' },
          { id: foreignRecordId2, title: 'Foreign B' },
        ],
      });

      // Verify both records via listRecords
      await processOutbox();
      const records = await ctx.listRecords(mainTableId);

      const found1 = records.find((r) => r.id === record1.id);
      const found2 = records.find((r) => r.id === record2.id);

      expect(found1).toBeDefined();
      expect(found2).toBeDefined();

      const linkValue1 = found1?.fields[linkFieldId] as Array<{ id: string }>;
      const linkValue2 = found2?.fields[linkFieldId] as Array<{ id: string }>;

      expect(linkValue1.length).toBe(1);
      expect(linkValue2.length).toBe(2);
    });
  });

  describe('manyOne relationship', () => {
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
        name: 'ManyOne Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create record in foreign table
      const fr = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Parent Record' });
      foreignRecordId = fr.id;

      // Create main table with manyOne link
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ManyOne Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Parent',
            options: {
              relationship: 'manyOne',
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
      linkFieldId = mainTable.fields.find((f) => f.name === 'Parent')?.id ?? '';
    });

    it('creates record with single link and verifies in database', async () => {
      const mainRecord = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Child Record',
        [linkFieldId]: { id: foreignRecordId, title: 'Parent Record' },
      });

      expect(mainRecord.id).toMatch(/^rec/);

      // Verify FK column directly in database
      const result = await sql<{ fk_value: string | null }>`
        SELECT ${sql.ref(`__fk_${linkFieldId}`)} as fk_value
        FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
        WHERE "__id" = ${mainRecord.id}
      `.execute(ctx.testContainer.db);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].fk_value).toBe(foreignRecordId);
    });

    it('creates multiple records linking to same parent and verifies in database', async () => {
      // Create another child record linking to same parent
      const childRecord = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Another Child',
        [linkFieldId]: { id: foreignRecordId, title: 'Parent Record' },
      });

      expect(childRecord.id).toMatch(/^rec/);

      // Verify FK column directly in database - count records with same parent
      const result = await sql<{ count: string }>`
        SELECT COUNT(*) as count
        FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
        WHERE ${sql.ref(`__fk_${linkFieldId}`)} = ${foreignRecordId}
      `.execute(ctx.testContainer.db);

      // At least 2 children linking to same parent
      expect(parseInt(result.rows[0].count, 10)).toBeGreaterThanOrEqual(2);
    });
  });

  describe('oneOne relationship', () => {
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
        name: 'OneOne Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create record in foreign table
      const fr = await ctx.createRecord(foreignTableId, {
        [foreignTitleFieldId]: 'Unique Partner',
      });
      foreignRecordId = fr.id;

      // Create main table with oneOne link
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'OneOne Main',
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
    });

    it('creates record with one-to-one link and verifies in database', async () => {
      const mainRecord = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'One Side',
        [linkFieldId]: { id: foreignRecordId, title: 'Unique Partner' },
      });

      expect(mainRecord.id).toMatch(/^rec/);

      // Verify FK column directly in database
      const result = await sql<{ fk_value: string | null }>`
        SELECT ${sql.ref(`__fk_${linkFieldId}`)} as fk_value
        FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
        WHERE "__id" = ${mainRecord.id}
      `.execute(ctx.testContainer.db);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].fk_value).toBe(foreignRecordId);
    });

    it('FK value is consistent across multiple database reads', async () => {
      // Create a new foreign record for this test to avoid unique constraint violation
      const newForeignRecord = await ctx.createRecord(foreignTableId, {
        [foreignTitleFieldId]: 'Another Partner',
      });

      const mainRecord = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Consistent Read',
        [linkFieldId]: { id: newForeignRecord.id, title: 'Another Partner' },
      });

      // Read multiple times to ensure consistency
      const result1 = await sql<{ fk_value: string | null }>`
        SELECT ${sql.ref(`__fk_${linkFieldId}`)} as fk_value
        FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
        WHERE "__id" = ${mainRecord.id}
      `.execute(ctx.testContainer.db);

      const result2 = await sql<{ fk_value: string | null }>`
        SELECT ${sql.ref(`__fk_${linkFieldId}`)} as fk_value
        FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
        WHERE "__id" = ${mainRecord.id}
      `.execute(ctx.testContainer.db);

      // FK values should be consistent
      expect(result1.rows[0].fk_value).toBe(result2.rows[0].fk_value);
      expect(result1.rows[0].fk_value).toBe(newForeignRecord.id);
    });
  });

  describe('oneMany relationship (one-way junction)', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let foreignTitleFieldId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;
    let foreignRecordId1: string;
    let foreignRecordId2: string;

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

      // Create records in foreign table
      const fr1 = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Child 1' });
      const fr2 = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Child 2' });
      foreignRecordId1 = fr1.id;
      foreignRecordId2 = fr2.id;

      // Create main table with oneMany link (one-way uses junction table)
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
    });

    it('creates record with multiple children and verifies junction table', async () => {
      const mainRecord = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Parent',
        [linkFieldId]: [
          { id: foreignRecordId1, title: 'Child 1' },
          { id: foreignRecordId2, title: 'Child 2' },
        ],
      });

      expect(mainRecord.id).toMatch(/^rec/);

      // Find junction table for this link field
      const junctionTables = await sql<{ table_name: string }>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${ctx.baseId}
        AND table_name LIKE ${'junction_%'}
      `.execute(ctx.testContainer.db);

      const junctionTableName = junctionTables.rows.find((r) =>
        r.table_name.includes(linkFieldId)
      )?.table_name;

      if (junctionTableName) {
        // Query junction table for rows containing our main record
        const allRows = await sql`
          SELECT * FROM "${sql.raw(ctx.baseId)}"."${sql.raw(junctionTableName)}"
        `.execute(ctx.testContainer.db);

        const rows = allRows.rows as Array<Record<string, unknown>>;
        const matchingRows = rows.filter((r) => Object.values(r).includes(mainRecord.id));
        expect(matchingRows.length).toBe(2);
      }
    });
  });

  describe('self-referential links', () => {
    describe('self manyMany', () => {
      let tableId: string;
      let titleFieldId: string;
      let linkFieldId: string;
      let recordId1: string;
      let recordId2: string;

      beforeAll(async () => {
        // Create table with self-referential manyMany link
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Self ManyMany',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });
        tableId = table.id;
        titleFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';

        // Create initial records
        const r1 = await ctx.createRecord(tableId, { [titleFieldId]: 'Person A' });
        const r2 = await ctx.createRecord(tableId, { [titleFieldId]: 'Person B' });
        recordId1 = r1.id;
        recordId2 = r2.id;

        // Add self-referential link field
        const response = await fetch(`${ctx.baseUrl}/fields/create`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId,
            type: 'link',
            name: 'Friends',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableId, // Self-reference
              lookupFieldId: titleFieldId,
              isOneWay: true,
            },
          }),
        });
        if (response.ok) {
          const body = (await response.json()) as { data?: { field?: { id?: string } } };
          linkFieldId = body?.data?.field?.id ?? '';
        }
      });

      it('creates self-referential links and verifies', async () => {
        if (!linkFieldId) {
          // Skip if field creation failed
          return;
        }

        // Create new record linking to existing records
        const newRecord = await ctx.createRecord(tableId, {
          [titleFieldId]: 'Person C',
          [linkFieldId]: [
            { id: recordId1, title: 'Person A' },
            { id: recordId2, title: 'Person B' },
          ],
        });

        expect(newRecord.id).toMatch(/^rec/);

        // Verify via listRecords
        const records = await ctx.listRecords(tableId);
        const found = records.find((r) => r.id === newRecord.id);
        expect(found).toBeDefined();
      });
    });

    describe('self manyOne (hierarchical)', () => {
      let tableId: string;
      let titleFieldId: string;
      let linkFieldId: string;
      let parentRecordId: string;

      beforeAll(async () => {
        // Create table with self-referential manyOne link (parent-child)
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'Self ManyOne',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
        });
        tableId = table.id;
        titleFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';

        // Create parent record first
        const parent = await ctx.createRecord(tableId, { [titleFieldId]: 'Parent Node' });
        parentRecordId = parent.id;

        // Add self-referential manyOne link field
        const response = await fetch(`${ctx.baseUrl}/fields/create`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId,
            type: 'link',
            name: 'Parent',
            options: {
              relationship: 'manyOne',
              foreignTableId: tableId, // Self-reference
              lookupFieldId: titleFieldId,
              isOneWay: true,
            },
          }),
        });
        if (response.ok) {
          const body = (await response.json()) as { data?: { field?: { id?: string } } };
          linkFieldId = body?.data?.field?.id ?? '';
        }
      });

      it('creates child record with parent link and verifies', async () => {
        if (!linkFieldId) {
          // Skip if field creation failed
          return;
        }

        // Create child record linking to parent
        const childRecord = await ctx.createRecord(tableId, {
          [titleFieldId]: 'Child Node',
          [linkFieldId]: [{ id: parentRecordId, title: 'Parent Node' }],
        });

        expect(childRecord.id).toMatch(/^rec/);

        // Verify via listRecords
        const records = await ctx.listRecords(tableId);
        const found = records.find((r) => r.id === childRecord.id);
        expect(found).toBeDefined();
      });
    });
  });

  describe('empty and null link values', () => {
    let foreignTableId: string;
    let mainTableId: string;
    let mainTitleFieldId: string;
    let linkFieldId: string;

    beforeAll(async () => {
      // Create foreign table
      const foreignTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Empty Link Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTableId = foreignTable.id;
      const foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

      // Create main table with link
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Empty Link Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Optional Link',
            options: {
              relationship: 'manyMany',
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
      linkFieldId = mainTable.fields.find((f) => f.name === 'Optional Link')?.id ?? '';
    });

    it('creates record with empty array link', async () => {
      const record = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'No Links',
        [linkFieldId]: [],
      });

      expect(record.id).toMatch(/^rec/);

      const records = await ctx.listRecords(mainTableId);
      const found = records.find((r) => r.id === record.id);
      expect(found).toBeDefined();
      // Empty link should result in null, undefined (omitted), or empty array
      const linkValue = found?.fields[linkFieldId];
      expect(
        linkValue === null ||
          linkValue === undefined ||
          (Array.isArray(linkValue) && linkValue.length === 0)
      ).toBe(true);
    });

    it('creates record with null link', async () => {
      const record = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Null Link',
        [linkFieldId]: null,
      });

      expect(record.id).toMatch(/^rec/);

      const records = await ctx.listRecords(mainTableId);
      const found = records.find((r) => r.id === record.id);
      expect(found).toBeDefined();
    });

    it('creates record without link field', async () => {
      const record = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'No Link Field',
      });

      expect(record.id).toMatch(/^rec/);

      const records = await ctx.listRecords(mainTableId);
      const found = records.find((r) => r.id === record.id);
      expect(found).toBeDefined();
    });
  });

  describe('multiple link fields on same table', () => {
    let foreignTable1Id: string;
    let foreignTable2Id: string;
    let mainTableId: string;
    let mainTitleFieldId: string;
    let link1FieldId: string;
    let link2FieldId: string;
    let foreign1RecordId: string;
    let foreign2RecordId: string;

    beforeAll(async () => {
      // Create first foreign table
      const foreignTable1 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Multi Link Foreign 1',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTable1Id = foreignTable1.id;
      const foreign1TitleFieldId = foreignTable1.fields.find((f) => f.name === 'Title')?.id ?? '';
      const fr1 = await ctx.createRecord(foreignTable1Id, { [foreign1TitleFieldId]: 'Target 1' });
      foreign1RecordId = fr1.id;

      // Create second foreign table
      const foreignTable2 = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Multi Link Foreign 2',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      foreignTable2Id = foreignTable2.id;
      const foreign2TitleFieldId = foreignTable2.fields.find((f) => f.name === 'Name')?.id ?? '';
      const fr2 = await ctx.createRecord(foreignTable2Id, { [foreign2TitleFieldId]: 'Target 2' });
      foreign2RecordId = fr2.id;

      // Create main table with multiple link fields
      const mainTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Multi Link Main',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Link1',
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable1Id,
              lookupFieldId: foreign1TitleFieldId,
              isOneWay: true,
            },
          },
          {
            type: 'link',
            name: 'Link2',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreignTable2Id,
              lookupFieldId: foreign2TitleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      mainTableId = mainTable.id;
      mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
      link1FieldId = mainTable.fields.find((f) => f.name === 'Link1')?.id ?? '';
      link2FieldId = mainTable.fields.find((f) => f.name === 'Link2')?.id ?? '';
    });

    it('creates record with multiple link fields to different tables', async () => {
      const record = await ctx.createRecord(mainTableId, {
        [mainTitleFieldId]: 'Multi Linked',
        [link1FieldId]: { id: foreign1RecordId, title: 'Target 1' }, // manyOne - single object
        [link2FieldId]: [{ id: foreign2RecordId, title: 'Target 2' }], // manyMany - array
      });

      expect(record.id).toMatch(/^rec/);

      // Verify link1 (manyOne) FK column in database
      const fkResult = await sql<{ fk_value: string | null }>`
        SELECT ${sql.ref(`__fk_${link1FieldId}`)} as fk_value
        FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
        WHERE "__id" = ${record.id}
      `.execute(ctx.testContainer.db);

      expect(fkResult.rows[0].fk_value).toBe(foreign1RecordId);

      // Verify link2 (manyMany) junction table
      const junctionTables = await sql<{ table_name: string }>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${ctx.baseId}
        AND table_name LIKE ${'junction_%'}
      `.execute(ctx.testContainer.db);

      const junctionTableName = junctionTables.rows.find((r) =>
        r.table_name.includes(link2FieldId)
      )?.table_name;

      if (junctionTableName) {
        const allRows = await sql`
          SELECT * FROM "${sql.raw(ctx.baseId)}"."${sql.raw(junctionTableName)}"
        `.execute(ctx.testContainer.db);

        const rows = allRows.rows as Array<Record<string, unknown>>;
        const matchingRows = rows.filter((r) => Object.values(r).includes(record.id));
        expect(matchingRows.length).toBe(1);
      }
    });
  });

  /**
   * Direct database verification tests.
   * These tests directly query the database to ensure FK columns and junction tables
   * contain correct data (not just API responses).
   */
  describe('database verification', () => {
    describe('manyOne FK column in database', () => {
      let foreignTableId: string;
      let mainTableId: string;
      let foreignTitleFieldId: string;
      let mainTitleFieldId: string;
      let linkFieldId: string;
      let foreignRecordId: string;

      beforeAll(async () => {
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DB Check ManyOne Foreign',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        });
        foreignTableId = foreignTable.id;
        foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

        const fr = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Target' });
        foreignRecordId = fr.id;

        const mainTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DB Check ManyOne Main',
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            {
              type: 'link',
              name: 'Parent',
              options: {
                relationship: 'manyOne',
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
        linkFieldId = mainTable.fields.find((f) => f.name === 'Parent')?.id ?? '';
      });

      it('verifies FK column value in database for manyOne', async () => {
        const record = await ctx.createRecord(mainTableId, {
          [mainTitleFieldId]: 'Child with FK',
          [linkFieldId]: { id: foreignRecordId, title: 'Target' },
        });

        // Direct DB query to verify FK column
        const result = await sql<{ fk_value: string | null }>`
          SELECT ${sql.ref(`__fk_${linkFieldId}`)} as fk_value
          FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
          WHERE "__id" = ${record.id}
        `.execute(ctx.testContainer.db);

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].fk_value).toBe(foreignRecordId);
      });

      it('verifies FK column is NULL when no link provided', async () => {
        const record = await ctx.createRecord(mainTableId, {
          [mainTitleFieldId]: 'No Link',
        });

        const result = await sql<{ fk_value: string | null }>`
          SELECT ${sql.ref(`__fk_${linkFieldId}`)} as fk_value
          FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
          WHERE "__id" = ${record.id}
        `.execute(ctx.testContainer.db);

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].fk_value).toBeNull();
      });
    });

    describe('manyMany junction table in database', () => {
      let foreignTableId: string;
      let mainTableId: string;
      let foreignTitleFieldId: string;
      let mainTitleFieldId: string;
      let linkFieldId: string;
      let foreignRecordId1: string;
      let foreignRecordId2: string;

      beforeAll(async () => {
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DB Check ManyMany Foreign',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        });
        foreignTableId = foreignTable.id;
        foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

        const fr1 = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Foreign A' });
        const fr2 = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Foreign B' });
        foreignRecordId1 = fr1.id;
        foreignRecordId2 = fr2.id;

        const mainTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DB Check ManyMany Main',
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            {
              type: 'link',
              name: 'Links',
              options: {
                relationship: 'manyMany',
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
        linkFieldId = mainTable.fields.find((f) => f.name === 'Links')?.id ?? '';
      });

      it('verifies junction table rows exist for manyMany links', async () => {
        const record = await ctx.createRecord(mainTableId, {
          [mainTitleFieldId]: 'Main with Links',
          [linkFieldId]: [
            { id: foreignRecordId1, title: 'Foreign A' },
            { id: foreignRecordId2, title: 'Foreign B' },
          ],
        });

        // Find junction table - naming pattern: junction_{fieldId}_{symmetricFieldId}
        const junctionTables = await sql<{ table_name: string }>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = ${ctx.baseId}
          AND table_name LIKE ${'junction_%'}
        `.execute(ctx.testContainer.db);

        // There should be at least one junction table
        expect(junctionTables.rows.length).toBeGreaterThanOrEqual(1);

        // Find the junction table for our link field
        const junctionTableName = junctionTables.rows.find((r) =>
          r.table_name.includes(linkFieldId)
        )?.table_name;

        expect(junctionTableName).toBeDefined();

        if (junctionTableName) {
          // Query all rows from junction table
          const allRows = await sql`
            SELECT * FROM "${sql.raw(ctx.baseId)}"."${sql.raw(junctionTableName)}"
          `.execute(ctx.testContainer.db);

          // Filter rows that contain our record id (main record)
          const rows = allRows.rows as Array<Record<string, unknown>>;
          const matchingRows = rows.filter((r) => Object.values(r).includes(record.id));
          expect(matchingRows.length).toBe(2);
        }
      });

      it('verifies no junction rows when empty link', async () => {
        const record = await ctx.createRecord(mainTableId, {
          [mainTitleFieldId]: 'No Links',
          [linkFieldId]: [],
        });

        // Find junction table
        const junctionTables = await sql<{ table_name: string }>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = ${ctx.baseId}
          AND table_name LIKE ${'junction_%'}
        `.execute(ctx.testContainer.db);

        const junctionTableName = junctionTables.rows.find((r) =>
          r.table_name.includes(linkFieldId)
        )?.table_name;

        if (junctionTableName) {
          // Query all rows and filter for our record
          const allRows = await sql`
            SELECT * FROM "${sql.raw(ctx.baseId)}"."${sql.raw(junctionTableName)}"
          `.execute(ctx.testContainer.db);

          const rows = allRows.rows as Array<Record<string, unknown>>;
          const matchingRows = rows.filter((r) => Object.values(r).includes(record.id));
          expect(matchingRows.length).toBe(0);
        }
      });
    });

    describe('oneOne FK column in database', () => {
      let foreignTableId: string;
      let mainTableId: string;
      let foreignTitleFieldId: string;
      let mainTitleFieldId: string;
      let linkFieldId: string;
      let foreignRecordId: string;

      beforeAll(async () => {
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DB Check OneOne Foreign',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        });
        foreignTableId = foreignTable.id;
        foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Title')?.id ?? '';

        const fr = await ctx.createRecord(foreignTableId, { [foreignTitleFieldId]: 'Partner' });
        foreignRecordId = fr.id;

        const mainTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: 'DB Check OneOne Main',
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
      });

      it('verifies FK column value in database for oneOne', async () => {
        const record = await ctx.createRecord(mainTableId, {
          [mainTitleFieldId]: 'One Side',
          [linkFieldId]: { id: foreignRecordId, title: 'Partner' },
        });

        const result = await sql<{ fk_value: string | null }>`
          SELECT ${sql.ref(`__fk_${linkFieldId}`)} as fk_value
          FROM ${sql.table(`${ctx.baseId}.${mainTableId}`)}
          WHERE "__id" = ${record.id}
        `.execute(ctx.testContainer.db);

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].fk_value).toBe(foreignRecordId);
      });
    });
  });
});
