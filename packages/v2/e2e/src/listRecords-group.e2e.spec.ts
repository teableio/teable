/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { FieldKeyType } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

/**
 * v1-parity listRecords groupBy coverage.
 *
 * v1 reference: apps/nestjs-backend/test/group.e2e-spec.ts
 *
 * v2 surface notes:
 * - `groupBy` is an array of field keys; the direction for a grouped field is
 *   taken from the matching `sort` entry (default asc). This mirrors v1's
 *   OpenAPI behaviour of folding groupBy into the sort chain.
 * - The v2 HTTP listRecords response exposes native `groups` metadata through
 *   an explicit opt-in instead of copying v1's presentation-oriented
 *   `extra.groupPoints` shape.
 *
 * Not ported (v1 cases with no v2 HTTP surface):
 * - v1 groupPoints/header ids (the v2 contract exposes value/count buckets).
 * - view group PUT round-trip → covered by viewOperations.e2e.spec.ts.
 */
describe('v2 listRecords groupBy (e2e)', () => {
  let ctx: SharedTestContext;
  let client: ReturnType<typeof createV2HttpClient>;

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listOrdered = async (
    tableId: string,
    options: {
      sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
      groupBy?: string[];
      viewId?: string;
    } = {}
  ) => {
    await drainOutbox();

    const params = new URLSearchParams({ tableId, fieldKeyType: FieldKeyType.Id });
    if (options.sort) params.set('sort', JSON.stringify(options.sort));
    if (options.groupBy) params.set('groupBy', JSON.stringify(options.groupBy));
    if (options.viewId) params.set('viewId', options.viewId);

    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const rawBody = await response.json();
    if (response.status !== 200) {
      throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
    }
    return parsed.data.data.records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    client = createV2HttpClient({ baseUrl: ctx.baseUrl });
  }, 60000);

  // ------------------------------------------------------------------
  // Single select grouping respects choice order
  // v1: "Single select grouping respects choice order"
  // ------------------------------------------------------------------
  describe('single select grouping respects choice order', () => {
    let tableId: string;
    let itemFieldId: string;
    let statusFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Single Select Order',
        fields: [
          { name: 'Item', type: 'singleLineText', isPrimary: true },
          {
            name: 'Stock Status',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'choice-0', name: 'Out of stock', color: 'red' },
                { id: 'choice-1', name: 'In stock', color: 'green' },
                { id: 'choice-2', name: 'Backordered', color: 'blue' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      itemFieldId = table.fields.find((f) => f.name === 'Item')?.id ?? '';
      statusFieldId = table.fields.find((f) => f.name === 'Stock Status')?.id ?? '';

      // Deliberately insert out of choice order to prove grouping reorders.
      await ctx.createRecords(tableId, [
        { fields: { [itemFieldId]: 'record-in-1', [statusFieldId]: 'In stock' } },
        { fields: { [itemFieldId]: 'record-back-1', [statusFieldId]: 'Backordered' } },
        { fields: { [itemFieldId]: 'record-out-1', [statusFieldId]: 'Out of stock' } },
        { fields: { [itemFieldId]: 'record-out-2', [statusFieldId]: 'Out of stock' } },
      ]);
    }, 60000);

    it('orders groups by choice order when ascending', async () => {
      const records = await listOrdered(tableId, { groupBy: [statusFieldId] });
      expect(records.map((record) => record.fields[statusFieldId])).toEqual([
        'Out of stock',
        'Out of stock',
        'In stock',
        'Backordered',
      ]);
      expect(records.map((record) => record.fields[itemFieldId])).toEqual([
        'record-out-1',
        'record-out-2',
        'record-in-1',
        'record-back-1',
      ]);
    });

    it('orders groups by reversed choice order when descending', async () => {
      const records = await listOrdered(tableId, {
        groupBy: [statusFieldId],
        sort: [{ fieldId: statusFieldId, order: 'desc' }],
      });
      expect(records.map((record) => record.fields[statusFieldId])).toEqual([
        'Backordered',
        'In stock',
        'Out of stock',
        'Out of stock',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // Base cellValueType grouping
  // v1: "OpenAPI ViewController raw group (e2e) base cellValueType"
  // ------------------------------------------------------------------
  describe('base cell value type grouping', () => {
    let tableId: string;
    let nameFieldId: string;
    let textFieldId: string;
    let numberFieldId: string;
    let dateFieldId: string;
    let checkFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Base Types',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
          { name: 'Number', type: 'number' },
          { name: 'Date', type: 'date' },
          { name: 'Check', type: 'checkbox' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Number')?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';
      checkFieldId = table.fields.find((f) => f.name === 'Check')?.id ?? '';

      await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 'g1',
            [textFieldId]: 'Beta',
            [numberFieldId]: 20,
            [dateFieldId]: '2024-02-20T12:00:00.000Z',
            [checkFieldId]: true,
          },
        },
        {
          fields: {
            [nameFieldId]: 'g2',
            [textFieldId]: 'Alpha',
            [numberFieldId]: 10,
            [dateFieldId]: '2024-01-10T12:00:00.000Z',
            [checkFieldId]: null,
          },
        },
        {
          fields: {
            [nameFieldId]: 'g3',
            [textFieldId]: 'Alpha',
            [numberFieldId]: 30,
            [dateFieldId]: '2024-03-15T12:00:00.000Z',
            [checkFieldId]: true,
          },
        },
        { fields: { [nameFieldId]: 'g4' } },
      ]);
    }, 60000);

    it.each([
      {
        label: 'string',
        getFieldId: () => textFieldId,
        // Alpha group (g2, g3 by auto number), Beta group, nulls first.
        asc: ['g4', 'g2', 'g3', 'g1'],
        desc: ['g1', 'g2', 'g3', 'g4'],
      },
      {
        label: 'number',
        getFieldId: () => numberFieldId,
        asc: ['g4', 'g2', 'g1', 'g3'],
        desc: ['g3', 'g1', 'g2', 'g4'],
      },
      {
        label: 'dateTime',
        getFieldId: () => dateFieldId,
        asc: ['g4', 'g2', 'g1', 'g3'],
        desc: ['g3', 'g1', 'g2', 'g4'],
      },
      {
        label: 'boolean',
        getFieldId: () => checkFieldId,
        // Unchecked cells are stored as null (T6520): g2/g4 form the null group.
        asc: ['g2', 'g4', 'g1', 'g3'],
        desc: ['g1', 'g3', 'g2', 'g4'],
      },
    ])(
      'groups by $label cell value type in asc and desc order',
      async ({ getFieldId, asc, desc }) => {
        const fieldId = getFieldId();
        const ascRecords = await listOrdered(tableId, { groupBy: [fieldId] });
        expect(ascRecords.map((record) => record.fields[nameFieldId])).toEqual(asc);

        const descRecords = await listOrdered(tableId, {
          groupBy: [fieldId],
          sort: [{ fieldId, order: 'desc' }],
        });
        expect(descRecords.map((record) => record.fields[nameFieldId])).toEqual(desc);
      }
    );

    it('applies the sort inside groups when groupBy and sort target different fields', async () => {
      // Group by text asc, sort number desc within each group.
      const records = await listOrdered(tableId, {
        groupBy: [textFieldId],
        sort: [{ fieldId: numberFieldId, order: 'desc' }],
      });
      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['g4', 'g3', 'g2', 'g1']);
    });
  });

  // ------------------------------------------------------------------
  // Lookup single select respects choice order when sorting groups
  // v1: "Lookup single select respects choice order when sorting groups"
  // ------------------------------------------------------------------
  describe('lookup single select grouping respects choice order', () => {
    let targetTableId: string;
    let taskFieldId: string;
    let categoryLookupFieldId: string;

    beforeAll(async () => {
      // Choice order deliberately opposite to alphabetical.
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup Choice Source',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Category',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'choice-0', name: 'Z-Type', color: 'blue' },
                { id: 'choice-1', name: 'A-Type', color: 'blue' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const sourceNameFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const sourceCategoryFieldId = sourceTable.fields.find((f) => f.name === 'Category')?.id ?? '';
      const itemA = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'Item-A',
        [sourceCategoryFieldId]: 'Z-Type',
      });
      const itemB = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'Item-B',
        [sourceCategoryFieldId]: 'A-Type',
      });

      const targetTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup Choice Target',
        fields: [
          { name: 'Task', type: 'singleLineText', isPrimary: true },
          {
            name: 'Link',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      targetTableId = targetTable.id;
      taskFieldId = targetTable.fields.find((f) => f.name === 'Task')?.id ?? '';
      const linkFieldId = targetTable.fields.find((f) => f.name === 'Link')?.id ?? '';

      const withLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: targetTableId,
        field: {
          type: 'lookup',
          name: 'Category',
          options: {
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceCategoryFieldId,
            linkFieldId,
          },
        },
      });
      categoryLookupFieldId = withLookup.fields.find((f) => f.name === 'Category')?.id ?? '';

      // Link in reverse order so ordering must come from choice order.
      await ctx.createRecords(targetTableId, [
        { fields: { [taskFieldId]: 'Task-B-Second', [linkFieldId]: [{ id: itemB.id }] } },
        { fields: { [taskFieldId]: 'Task-A-First', [linkFieldId]: [{ id: itemA.id }] } },
      ]);
    }, 120000);

    it('sorts grouped records by the lookup choice order', async () => {
      const records = await listOrdered(targetTableId, { groupBy: [categoryLookupFieldId] });
      expect(records.map((record) => record.fields[taskFieldId])).toEqual([
        'Task-A-First',
        'Task-B-Second',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // Lookup multiple select respects choice order (first choice)
  // v1: "Lookup multiple select respects choice order when sorting groups"
  // ------------------------------------------------------------------
  describe('lookup multiple select grouping by first choice', () => {
    let targetTableId: string;
    let taskFieldId: string;
    let tagsLookupFieldId: string;

    beforeAll(async () => {
      const choiceOrder = ['Option-One', 'Option-Two', 'Option-Three'];
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup Multi Source',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Tags',
            type: 'multipleSelect',
            options: {
              choices: choiceOrder.map((name, index) => ({
                id: `choice-${index}`,
                name,
                color: 'blue',
              })),
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const sourceNameFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const sourceTagsFieldId = sourceTable.fields.find((f) => f.name === 'Tags')?.id ?? '';
      const src1 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'SRC-1',
        [sourceTagsFieldId]: ['Option-Two', 'Option-One'], // first Option-Two
      });
      const src2 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'SRC-2',
        [sourceTagsFieldId]: ['Option-One', 'Option-Three'], // first Option-One
      });
      const src3 = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'SRC-3',
        [sourceTagsFieldId]: ['Option-Three'], // first Option-Three
      });

      const targetTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup Multi Target',
        fields: [
          { name: 'Task', type: 'singleLineText', isPrimary: true },
          {
            name: 'Link',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      targetTableId = targetTable.id;
      taskFieldId = targetTable.fields.find((f) => f.name === 'Task')?.id ?? '';
      const linkFieldId = targetTable.fields.find((f) => f.name === 'Link')?.id ?? '';

      const withLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: targetTableId,
        field: {
          type: 'lookup',
          name: 'Tags',
          options: {
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceTagsFieldId,
            linkFieldId,
          },
        },
      });
      tagsLookupFieldId = withLookup.fields.find((f) => f.name === 'Tags')?.id ?? '';

      await ctx.createRecords(targetTableId, [
        { fields: { [taskFieldId]: 'Task-TwoAndOne', [linkFieldId]: [{ id: src1.id }] } },
        { fields: { [taskFieldId]: 'Task-OneAndThree', [linkFieldId]: [{ id: src2.id }] } },
        { fields: { [taskFieldId]: 'Task-ThreeSolo', [linkFieldId]: [{ id: src3.id }] } },
      ]);
    }, 120000);

    it('sorts lookup multiple select groups by choice order using the first choice', async () => {
      const records = await listOrdered(targetTableId, { groupBy: [tagsLookupFieldId] });
      expect(records.map((record) => record.fields[taskFieldId])).toEqual([
        'Task-OneAndThree',
        'Task-TwoAndOne',
        'Task-ThreeSolo',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // Two-level grouping: lookup single select then lookup text
  // v1: "Lookup grouping keeps headers aligned"
  // ------------------------------------------------------------------
  describe('two-level lookup grouping', () => {
    let taskTableId: string;
    let taskNameFieldId: string;
    let categoryLookupFieldId: string;
    let subjectLookupFieldId: string;

    beforeAll(async () => {
      const categoryChoices = ['Teaching Contest', 'Faculty Contest', 'World Skills', 'Other'];
      const projectDefinitions = [
        { name: 'Ethics Deck', category: 'Teaching Contest', subject: 'Ethics & Law' },
        { name: 'Culinary Basics', category: 'Faculty Contest', subject: 'Chinese Cuisine' },
        { name: 'Vision Health', category: 'World Skills', subject: 'Optometry' },
        { name: 'VR Deck A', category: 'Other', subject: 'VR Banking English' },
        { name: 'VR Deck B', category: 'Other', subject: 'VR Banking English - Final' },
      ];

      const projectTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup Projects',
        fields: [
          { name: 'Project Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Category',
            type: 'singleSelect',
            options: {
              choices: categoryChoices.map((name, index) => ({
                id: `choice-${index}`,
                name,
                color: 'blue',
              })),
            },
          },
          { name: 'Subject', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });
      const projectNameFieldId = projectTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const projectCategoryFieldId =
        projectTable.fields.find((f) => f.name === 'Category')?.id ?? '';
      const projectSubjectFieldId = projectTable.fields.find((f) => f.name === 'Subject')?.id ?? '';

      const projectRecords: Array<{ id: string }> = [];
      for (const definition of projectDefinitions) {
        projectRecords.push(
          await ctx.createRecord(projectTable.id, {
            [projectNameFieldId]: definition.name,
            [projectCategoryFieldId]: definition.category,
            [projectSubjectFieldId]: definition.subject,
          })
        );
      }

      const taskTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup Tasks',
        fields: [
          { name: 'Task Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Linked Project',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: projectTable.id,
              lookupFieldId: projectNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      taskTableId = taskTable.id;
      taskNameFieldId = taskTable.fields.find((f) => f.name === 'Task Name')?.id ?? '';
      const linkFieldId = taskTable.fields.find((f) => f.name === 'Linked Project')?.id ?? '';

      const withCategoryLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: taskTableId,
        field: {
          type: 'lookup',
          name: 'Category',
          options: {
            foreignTableId: projectTable.id,
            lookupFieldId: projectCategoryFieldId,
            linkFieldId,
          },
        },
      });
      categoryLookupFieldId =
        withCategoryLookup.fields.find((f) => f.name === 'Category')?.id ?? '';

      const withSubjectLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: taskTableId,
        field: {
          type: 'lookup',
          name: 'Subject',
          options: {
            foreignTableId: projectTable.id,
            lookupFieldId: projectSubjectFieldId,
            linkFieldId,
          },
        },
      });
      subjectLookupFieldId = withSubjectLookup.fields.find((f) => f.name === 'Subject')?.id ?? '';

      // Insert tasks in reverse project order so grouping must reorder them.
      const reversed = [...projectDefinitions.keys()].reverse();
      await ctx.createRecords(
        taskTableId,
        reversed.map((index) => ({
          fields: {
            [taskNameFieldId]: `Task-${index + 1}-${projectDefinitions[index].name}`,
            [linkFieldId]: [{ id: projectRecords[index].id }],
          },
        }))
      );
    }, 120000);

    it('groups by lookup single select then lookup text in expected order', async () => {
      const records = await listOrdered(taskTableId, {
        groupBy: [categoryLookupFieldId, subjectLookupFieldId],
      });
      expect(records.map((record) => record.fields[taskNameFieldId])).toEqual([
        'Task-1-Ethics Deck',
        'Task-2-Culinary Basics',
        'Task-3-Vision Health',
        'Task-4-VR Deck A',
        'Task-5-VR Deck B',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // Special characters in choice names
  // v1: "Single select grouping with special characters in choice names" /
  //     "Multiple select grouping with special characters in choice names"
  // ------------------------------------------------------------------
  describe('grouping with special characters in choice names', () => {
    it('groups single select correctly when choice names contain "?"', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Special Char Single',
        fields: [
          { name: 'Item', type: 'singleLineText', isPrimary: true },
          {
            name: 'Status',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'sc-choice-0', name: 'Pending?', color: 'red' },
                { id: 'sc-choice-1', name: 'Done!', color: 'green' },
                { id: 'sc-choice-2', name: 'N/A', color: 'blue' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const itemFieldId = table.fields.find((f) => f.name === 'Item')?.id ?? '';
      const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';

      // Insert in reverse choice order.
      await ctx.createRecords(table.id, [
        { fields: { [itemFieldId]: 'r3', [statusFieldId]: 'N/A' } },
        { fields: { [itemFieldId]: 'r2', [statusFieldId]: 'Done!' } },
        { fields: { [itemFieldId]: 'r1', [statusFieldId]: 'Pending?' } },
      ]);

      const records = await listOrdered(table.id, { groupBy: [statusFieldId] });
      expect(records.map((record) => record.fields[statusFieldId])).toEqual([
        'Pending?',
        'Done!',
        'N/A',
      ]);
      expect(records.map((record) => record.fields[itemFieldId])).toEqual(['r1', 'r2', 'r3']);
    });

    it('groups multiple select correctly when choice names contain "?"', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Special Char Multi',
        fields: [
          { name: 'Item', type: 'singleLineText', isPrimary: true },
          {
            name: 'Tags',
            type: 'multipleSelect',
            options: {
              choices: [
                { id: 'ms-choice-0', name: 'Alpha?', color: 'red' },
                { id: 'ms-choice-1', name: 'Beta!', color: 'green' },
                { id: 'ms-choice-2', name: 'Gamma', color: 'blue' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const itemFieldId = table.fields.find((f) => f.name === 'Item')?.id ?? '';
      const tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';

      await ctx.createRecords(table.id, [
        { fields: { [itemFieldId]: 'r3', [tagsFieldId]: ['Gamma'] } },
        { fields: { [itemFieldId]: 'r2', [tagsFieldId]: ['Beta!'] } },
        { fields: { [itemFieldId]: 'r1', [tagsFieldId]: ['Alpha?'] } },
      ]);

      const records = await listOrdered(table.id, { groupBy: [tagsFieldId] });
      expect(records).toHaveLength(3);
      expect(records.map((record) => record.fields[itemFieldId])).toEqual(['r1', 'r2', 'r3']);
    });
  });

  // ------------------------------------------------------------------
  // View default group applies when listing with viewId
  // v1: group is a view property consumed by getRecords(viewId)
  // ------------------------------------------------------------------
  describe('view default group', () => {
    it('applies the view group defaults when listing with viewId only', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group View Defaults',
        fields: [
          { name: 'Item', type: 'singleLineText', isPrimary: true },
          {
            name: 'Status',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'vg-choice-0', name: 'First', color: 'red' },
                { id: 'vg-choice-1', name: 'Second', color: 'green' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const viewId = table.views[0]?.id ?? '';
      const itemFieldId = table.fields.find((f) => f.name === 'Item')?.id ?? '';
      const statusFieldId = table.fields.find((f) => f.name === 'Status')?.id ?? '';

      await ctx.createRecords(table.id, [
        { fields: { [itemFieldId]: 'r1', [statusFieldId]: 'First' } },
        { fields: { [itemFieldId]: 'r2', [statusFieldId]: 'Second' } },
        { fields: { [itemFieldId]: 'r3', [statusFieldId]: 'First' } },
      ]);

      const grouped = await client.tables.updateViewGroup({
        tableId: table.id,
        viewId,
        group: [{ fieldId: statusFieldId, order: 'desc' }],
      });
      expect(grouped.ok).toBe(true);

      const records = await listOrdered(table.id, { viewId });
      expect(records.map((record) => record.fields[itemFieldId])).toEqual(['r2', 'r1', 'r3']);
    });
  });

  // ------------------------------------------------------------------
  // Group by user + sort by date desc (T6751)
  // Sanitized, structure-equivalent: user group, date-only field
  // (time None / Asia/Shanghai), mixed years inserted older-first so a
  // missing within-group date sort would leave later 2026 rows at the bottom.
  // ------------------------------------------------------------------
  describe('group by user and sort by date descending (T6751)', () => {
    let tableId: string;
    let nameFieldId: string;
    let ownerFieldId: string;
    let dateFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group User Date Sort',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Owner', type: 'user', options: { isMultiple: false } },
          {
            name: 'Payment Date',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
            },
          },
          { name: 'Amount', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      ownerFieldId = table.fields.find((f) => f.name === 'Owner')?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'Payment Date')?.id ?? '';
      const amountFieldId = table.fields.find((f) => f.name === 'Amount')?.id ?? '';

      await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'Title Formula',
          options: { expression: `{${amountFieldId}} & " | " & {${dateFieldId}}` },
        },
      });

      const owner = { id: TEST_USER.id, title: TEST_USER.name };
      // Insert older dates first (already descending among themselves), then
      // append later-year rows. A working date desc sort must lift the 2026
      // rows above 2025/2024; auto-number order would leave them last.
      await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 'd-2025-07',
            [ownerFieldId]: owner,
            [dateFieldId]: '2025-07-31T00:00:00.000Z',
            [amountFieldId]: 100,
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2025-04',
            [ownerFieldId]: owner,
            [dateFieldId]: '2025-04-29T00:00:00.000Z',
            [amountFieldId]: 200,
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2024-11',
            [ownerFieldId]: owner,
            [dateFieldId]: '2024-11-14T00:00:00.000Z',
            [amountFieldId]: 300,
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2024-10',
            [ownerFieldId]: owner,
            [dateFieldId]: '2024-10-09T00:00:00.000Z',
            [amountFieldId]: 400,
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2026-02',
            [ownerFieldId]: owner,
            [dateFieldId]: '2026-02-04T00:00:00.000Z',
            [amountFieldId]: 840,
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2026-01',
            [ownerFieldId]: owner,
            [dateFieldId]: '2026-01-29T00:00:00.000Z',
            [amountFieldId]: 500,
          },
        },
      ]);
    }, 120000);

    it('keeps later years first within the same user group', async () => {
      const records = await listOrdered(tableId, {
        groupBy: [ownerFieldId],
        sort: [{ fieldId: dateFieldId, order: 'desc' }],
      });
      expect(records.map((record) => record.fields[nameFieldId])).toEqual([
        'd-2026-02',
        'd-2026-01',
        'd-2025-07',
        'd-2025-04',
        'd-2024-11',
        'd-2024-10',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // Group by lookup-of-user + sort by date desc (T6751)
  // Sanitized, structure-equivalent: manyOne link, lookup of a user field,
  // date-only sort. The same collaborator is stored with snapshot drift
  // (email/avatar). Presentation folds those buckets into one group header;
  // within-group date desc must span the whole collaborator, not each
  // snapshot run.
  // ------------------------------------------------------------------
  describe('group by lookup of user and sort by date descending (T6751)', () => {
    let tableId: string;
    let nameFieldId: string;
    let dateFieldId: string;
    let ownerLookupFieldId: string;

    beforeAll(async () => {
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup User Source',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Owner', type: 'user', options: { isMultiple: false } },
        ],
        views: [{ type: 'grid' }],
      });
      const sourceNameFieldId = sourceTable.fields.find((f) => f.name === 'Name')?.id ?? '';
      const sourceOwnerFieldId = sourceTable.fields.find((f) => f.name === 'Owner')?.id ?? '';

      const sourceOlder = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'older-orders',
        [sourceOwnerFieldId]: { id: TEST_USER.id, title: TEST_USER.name },
      });
      const sourceNewer = await ctx.createRecord(sourceTable.id, {
        [sourceNameFieldId]: 'newer-orders',
        [sourceOwnerFieldId]: { id: TEST_USER.id, title: TEST_USER.name },
      });

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Lookup User Date Sort',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Payment Date',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Shanghai' },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = hostTable.id;
      nameFieldId = hostTable.fields.find((f) => f.name === 'Name')?.id ?? '';
      dateFieldId = hostTable.fields.find((f) => f.name === 'Payment Date')?.id ?? '';

      const withLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'link',
          name: 'Order',
          options: {
            relationship: 'manyOne',
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceNameFieldId,
            isOneWay: true,
          },
        },
      });
      const linkFieldId = withLink.fields.find((f) => f.name === 'Order')?.id ?? '';

      const withLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'lookup',
          name: 'Owner Lookup',
          options: {
            linkFieldId,
            foreignTableId: sourceTable.id,
            lookupFieldId: sourceOwnerFieldId,
          },
        },
      });
      ownerLookupFieldId = withLookup.fields.find((f) => f.name === 'Owner Lookup')?.id ?? '';

      const created = await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 'd-2025-07',
            [dateFieldId]: '2025-07-31T00:00:00.000Z',
            [linkFieldId]: { id: sourceOlder.id },
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2025-04',
            [dateFieldId]: '2025-04-29T00:00:00.000Z',
            [linkFieldId]: { id: sourceOlder.id },
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2024-11',
            [dateFieldId]: '2024-11-14T00:00:00.000Z',
            [linkFieldId]: { id: sourceOlder.id },
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2026-02',
            [dateFieldId]: '2026-02-04T00:00:00.000Z',
            [linkFieldId]: { id: sourceNewer.id },
          },
        },
        {
          fields: {
            [nameFieldId]: 'd-2026-01',
            [dateFieldId]: '2026-01-29T00:00:00.000Z',
            [linkFieldId]: { id: sourceNewer.id },
          },
        },
      ]);
      await drainOutbox();

      const hostSchema = await ctx.getTableById(tableId);
      const lookupDbFieldName = hostSchema.fields.find(
        (field) => field.id === ownerLookupFieldId
      )?.dbFieldName;
      if (!lookupDbFieldName) {
        throw new Error('Owner lookup db field name is missing');
      }

      const olderIds = created
        .filter((record) =>
          ['d-2025-07', 'd-2025-04', 'd-2024-11'].includes(String(record.fields[nameFieldId]))
        )
        .map((record) => record.id);
      const newerIds = created
        .filter((record) => ['d-2026-02', 'd-2026-01'].includes(String(record.fields[nameFieldId])))
        .map((record) => record.id);

      const olderSnapshot = JSON.stringify({
        id: TEST_USER.id,
        title: TEST_USER.name,
        email: 'a@example.com',
      });
      const newerSnapshot = JSON.stringify({
        id: TEST_USER.id,
        title: TEST_USER.name,
        email: 'z@example.com',
        avatarUrl: 'https://example.com/avatar.png',
      });

      for (const recordId of olderIds) {
        await sql`
          UPDATE ${sql.table(`${ctx.baseId}.${tableId}`)}
          SET ${sql.ref(lookupDbFieldName)} = ${olderSnapshot}::jsonb
          WHERE __id = ${recordId}
        `.execute(ctx.testContainer.db);
      }
      for (const recordId of newerIds) {
        await sql`
          UPDATE ${sql.table(`${ctx.baseId}.${tableId}`)}
          SET ${sql.ref(lookupDbFieldName)} = ${newerSnapshot}::jsonb
          WHERE __id = ${recordId}
        `.execute(ctx.testContainer.db);
      }
    }, 120000);

    it('keeps later years first across lookup user snapshot variants', async () => {
      const params = new URLSearchParams({ tableId, fieldKeyType: FieldKeyType.Id });
      params.set('groupBy', JSON.stringify([ownerLookupFieldId]));
      params.set('sort', JSON.stringify([{ fieldId: dateFieldId, order: 'desc' }]));
      const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      const rawBody = await response.json();
      if (response.status !== 200) {
        throw new Error(`ListRecords failed: ${JSON.stringify(rawBody)}`);
      }
      const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) {
        throw new Error(`ListRecords response invalid: ${JSON.stringify(rawBody)}`);
      }
      expect(parsed.data.data.records.map((record) => record.fields[nameFieldId])).toEqual([
        'd-2026-02',
        'd-2026-01',
        'd-2025-07',
        'd-2025-04',
        'd-2024-11',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // Button field cannot be used in view group
  // v1: "should not allow to modify group for button field"
  // ------------------------------------------------------------------
  describe('view group validation', () => {
    it('rejects updating a view group with a button field', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Group Button Reject',
        fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const withButton = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: { type: 'button', name: 'Push' },
      });
      const buttonFieldId = withButton.fields.find((f) => f.name === 'Push')?.id ?? '';
      expect(buttonFieldId).not.toBe('');

      await expect(
        client.tables.updateViewGroup({
          tableId: table.id,
          viewId: table.views[0]?.id ?? '',
          group: [{ fieldId: buttonFieldId, order: 'asc' }],
        })
      ).rejects.toThrow(/Button/);
    });
  });
});
