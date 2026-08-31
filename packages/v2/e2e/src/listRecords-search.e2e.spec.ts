/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * v1-parity listRecords search coverage.
 *
 * v1 references:
 * - apps/nestjs-backend/test/record-search-query.e2e-spec.ts
 * - apps/nestjs-backend/test/aggregation-search.e2e-spec.ts (search half)
 *
 * v2 search tuple (recordSearchInputSchema): [value], [value, fieldKeys] or
 * [value, fieldKeys, hideNotMatchRow]. Only hideNotMatchRow=true affects the
 * returned rows; the highlight-only forms leave the row set untouched.
 *
 * Semantics under test (T6520):
 * - substring match is case-insensitive (ILIKE).
 * - number cells match their formatted text (ROUND to the field precision),
 *   so "19.0" matches a precision-1 value of 19 while "19.00" does not.
 * - date cells match a whole formatted day when the field is targeted, and
 *   are excluded from all-field searches (v1 hide-not-match parity).
 * - checkbox cells produce no search predicate; targeting only a checkbox
 *   field filters nothing and returns every row (v1 parity: x_20 checkbox
 *   search returned all 23 rows).
 * - multi-value cells match against their joined "a, b" cell text.
 *
 * Not ported (different v2 HTTP shape):
 * - v1 extra.searchHitIndex / highlight structure. The v2 contract exposes
 *   native `searchMatches` metadata through an explicit opt-in.
 * - record/socket/doc-ids projection endpoint.
 * - getSearchIndex / getSearchCount / getRecordIndex endpoints.
 * - trgm/tsvector search-index management (toggleTableIndex, abnormal index
 *   list/repair, index rename on dbFieldName change, button index skip):
 *   generated-column access paths cannot be toggled through the v2 contract.
 */
describe('v2 listRecords search (e2e)', () => {
  let ctx: SharedTestContext;

  const drainOutbox = async (rounds = 10) => {
    for (let i = 0; i < rounds; i += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
    }
  };

  const listWithSearch = async (
    tableId: string,
    options: {
      search?: [string] | [string, string] | [string, string, boolean];
      filter?: unknown;
      sort?: Array<{ fieldId: string; order: 'asc' | 'desc' }>;
    } = {}
  ) => {
    await drainOutbox();

    const params = new URLSearchParams({ tableId, fieldKeyType: FieldKeyType.Id });
    if (options.search) params.set('search', JSON.stringify(options.search));
    if (options.filter) params.set('filter', JSON.stringify(options.filter));
    if (options.sort) params.set('sort', JSON.stringify(options.sort));

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

  const expectSearchCount = async (
    tableId: string,
    search: [string] | [string, string] | [string, string, boolean],
    expected: number
  ) => {
    const records = await listWithSearch(tableId, { search });
    expect(records).toHaveLength(expected);
    return records;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 60000);

  // ------------------------------------------------------------------
  // Basic field-type search matrix
  // v1: "basis field search record" > "simple search fields"
  // ------------------------------------------------------------------
  describe('basic field search', () => {
    let tableId: string;
    let textFieldId: string;
    let longTextFieldId: string;
    let numberFieldId: string;
    let dateFieldId: string;
    let checkboxFieldId: string;
    let selectFieldId: string;
    let tagsFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Search Basic Types',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
          { name: 'Long', type: 'longText' },
          {
            name: 'Number',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
          {
            name: 'Date',
            type: 'date',
            options: { formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' } },
          },
          { name: 'Check', type: 'checkbox' },
          {
            name: 'Select',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'cho1', name: 'test', color: 'blue' },
                { id: 'cho2', name: 'dev', color: 'green' },
                { id: 'cho3', name: 'other', color: 'red' },
              ],
            },
          },
          {
            name: 'Tags',
            type: 'multipleSelect',
            options: {
              choices: [
                { id: 'choX', name: 'rap', color: 'blue' },
                { id: 'choY', name: 'rock', color: 'green' },
                { id: 'choZ', name: 'hiphop', color: 'red' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
      longTextFieldId = table.fields.find((f) => f.name === 'Long')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Number')?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';
      checkboxFieldId = table.fields.find((f) => f.name === 'Check')?.id ?? '';
      selectFieldId = table.fields.find((f) => f.name === 'Select')?.id ?? '';
      tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';

      await ctx.createRecords(tableId, [
        {
          fields: {
            [textFieldId]: 'Text Field 19',
            [numberFieldId]: 19,
            [dateFieldId]: '2022-03-02T12:00:00.000Z',
            [checkboxFieldId]: true,
            [selectFieldId]: 'test',
            [tagsFieldId]: ['hiphop', 'rock'],
          },
        },
        {
          fields: {
            [textFieldId]: 'Text Field 20',
            [numberFieldId]: 20.3,
            [dateFieldId]: '2022-05-01T12:00:00.000Z',
            [selectFieldId]: 'dev',
            [tagsFieldId]: ['rap'],
          },
        },
        {
          fields: {
            [textFieldId]: 'zebra Z',
            [numberFieldId]: 100,
            [longTextFieldId]: 'hello\nnewYork, London\nlove',
          },
        },
        { fields: { [textFieldId]: '100 items' } },
        { fields: {} },
      ]);
    }, 60000);

    it('matches a text substring case-insensitively when targeting a field', async () => {
      await expectSearchCount(tableId, ['field 19', textFieldId, true], 1);
      await expectSearchCount(tableId, ['Field', textFieldId, true], 2);
      await expectSearchCount(tableId, ['TEXT FIELD', textFieldId, true], 2);
    });

    it('matches numbers against their formatted precision text', async () => {
      // precision 1: 19 renders as "19.0"
      await expectSearchCount(tableId, ['19.0', numberFieldId, true], 1);
      await expectSearchCount(tableId, ['19.00', numberFieldId, true], 0);
      // 20.3 contains "0.3"
      await expectSearchCount(tableId, ['0.3', numberFieldId, true], 1);
    });

    it('does not match number fields for non-numeric text when targeted', async () => {
      await expectSearchCount(tableId, ['apple', numberFieldId, true], 0);
    });

    it('matches dates against a whole formatted day when targeted', async () => {
      await expectSearchCount(tableId, ['2022-03-02', dateFieldId, true], 1);
      await expectSearchCount(tableId, ['2022-02-28', dateFieldId, true], 0);
    });

    it('returns all rows when targeting only a checkbox field (no search predicate, v1 parity)', async () => {
      await expectSearchCount(tableId, ['true', checkboxFieldId, true], 5);
    });

    it('matches single select choice names', async () => {
      await expectSearchCount(tableId, ['test', selectFieldId, true], 1);
      await expectSearchCount(tableId, ['dev', selectFieldId, true], 1);
    });

    it('matches multiple select against the joined cell text', async () => {
      await expectSearchCount(tableId, ['hiphop', tagsFieldId, true], 1);
      await expectSearchCount(tableId, ['hiphop, rock', tagsFieldId, true], 1);
      await expectSearchCount(tableId, ['rock, hiphop', tagsFieldId, true], 0);
    });

    it('finds no rows for a double quote probe', async () => {
      await expectSearchCount(tableId, ['"', textFieldId, true], 0);
    });

    it('matches multiline long text with line breaks flattened to spaces', async () => {
      await expectSearchCount(tableId, ['hello newYork, London love', longTextFieldId, true], 1);
    });

    it('supports comma-separated field keys', async () => {
      // "100" appears in Number (100.0) and in Text ("100 items").
      await expectSearchCount(tableId, ['100', `${textFieldId},${numberFieldId}`, true], 2);
    });

    describe('global search', () => {
      it('does not match number fields when searching non-numeric text', async () => {
        const records = await expectSearchCount(tableId, ['zebra', '', true], 1);
        expect(records[0]?.fields[textFieldId]).toBe('zebra Z');
      });

      it('matches both text and number fields when searching numeric text', async () => {
        // "100" -> text "100 items" + number 100.0
        await expectSearchCount(tableId, ['100', '', true], 2);
      });

      it('excludes date fields from all-field searches (hide-not-match parity)', async () => {
        await expectSearchCount(tableId, ['2022-03-02', '', true], 0);
      });
    });

    describe('highlight-only search tuples do not filter rows', () => {
      it('keeps all rows when the hide flag is omitted', async () => {
        await expectSearchCount(tableId, ['field 19'], 5);
        await expectSearchCount(tableId, ['field 19', textFieldId], 5);
      });

      it('keeps all rows when hideNotMatchRow is false', async () => {
        await expectSearchCount(tableId, ['field 19', textFieldId, false], 5);
      });
    });

    describe('search combined with filter and sort', () => {
      it('intersects the search row filter with the query filter', async () => {
        const records = await listWithSearch(tableId, {
          search: ['Field', textFieldId, true],
          filter: { fieldId: numberFieldId, operator: 'isGreater', value: 19 },
        });
        expect(records).toHaveLength(1);
        expect(records[0]?.fields[textFieldId]).toBe('Text Field 20');
      });

      it('applies sort to the matching rows', async () => {
        const records = await listWithSearch(tableId, {
          search: ['Field', textFieldId, true],
          sort: [{ fieldId: numberFieldId, order: 'desc' }],
        });
        expect(records.map((record) => record.fields[textFieldId])).toEqual([
          'Text Field 20',
          'Text Field 19',
        ]);
      });
    });
  });

  // ------------------------------------------------------------------
  // Special characters
  // v1: "search value with special characters"
  // ------------------------------------------------------------------
  describe('search value with special characters', () => {
    it('matches values containing "+" characters', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Search Special Characters',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
        ],
        views: [{ type: 'grid' }],
      });
      const textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
      await ctx.createRecords(table.id, [
        { fields: { [textFieldId]: 'notepad++' } },
        { fields: { [textFieldId]: 'notepad' } },
      ]);

      await expectSearchCount(table.id, ['notepad++', textFieldId, true], 1);
    });
  });

  // ------------------------------------------------------------------
  // Computed / linked record fields (#2015)
  // v1: "search linked record fields (#2015)" > "get records search results"
  // ------------------------------------------------------------------
  describe('search linked record fields', () => {
    let projectsTableId: string;
    let projectFieldId: string;
    let linkFieldId: string;
    let lookupFieldId: string;
    let rollupFieldId: string;
    let formulaFieldId: string;

    beforeAll(async () => {
      const peopleTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Search Link People',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Score', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const peopleNameFieldId = peopleTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const peopleScoreFieldId = peopleTable.fields.find((f) => f.name === 'Score')?.id ?? '';
      const alice = await ctx.createRecord(peopleTable.id, {
        [peopleNameFieldId]: 'Alice Johnson',
        [peopleScoreFieldId]: 100,
      });
      const bob = await ctx.createRecord(peopleTable.id, {
        [peopleNameFieldId]: 'Bob Smith',
        [peopleScoreFieldId]: 200,
      });

      const projectsTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Search Link Projects',
        fields: [
          { name: 'Project', type: 'singleLineText', isPrimary: true },
          {
            name: 'Owner',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: peopleTable.id,
              lookupFieldId: peopleNameFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      projectsTableId = projectsTable.id;
      projectFieldId = projectsTable.fields.find((f) => f.name === 'Project')?.id ?? '';
      linkFieldId = projectsTable.fields.find((f) => f.name === 'Owner')?.id ?? '';

      const withLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: projectsTableId,
        field: {
          type: 'lookup',
          name: 'Owner Name Lookup',
          options: {
            foreignTableId: peopleTable.id,
            lookupFieldId: peopleNameFieldId,
            linkFieldId,
          },
        },
      });
      lookupFieldId = withLookup.fields.find((f) => f.name === 'Owner Name Lookup')?.id ?? '';

      const withRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: projectsTableId,
        field: {
          type: 'rollup',
          name: 'Owner Score Total',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: peopleTable.id,
            lookupFieldId: peopleScoreFieldId,
            linkFieldId,
          },
        },
      });
      rollupFieldId = withRollup.fields.find((f) => f.name === 'Owner Score Total')?.id ?? '';

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: projectsTableId,
        field: {
          type: 'formula',
          name: 'Project Uppercase',
          options: { expression: `UPPER({${projectFieldId}})` },
        },
      });
      formulaFieldId = withFormula.fields.find((f) => f.name === 'Project Uppercase')?.id ?? '';

      await ctx.createRecords(projectsTableId, [
        {
          fields: {
            [projectFieldId]: 'Website Redesign',
            [linkFieldId]: [{ id: alice.id }],
          },
        },
        {
          fields: {
            [projectFieldId]: 'Mobile App',
            [linkFieldId]: [{ id: bob.id }],
          },
        },
      ]);
    }, 120000);

    const matchedProject = (records: Array<{ fields: Record<string, unknown> }>) =>
      records.map((record) => record.fields[projectFieldId]);

    it.each([
      { label: 'link', getFieldId: () => linkFieldId, searchValue: 'Alice Johnson' },
      { label: 'lookup', getFieldId: () => lookupFieldId, searchValue: 'Alice Johnson' },
      { label: 'rollup', getFieldId: () => rollupFieldId, searchValue: '100' },
      { label: 'formula', getFieldId: () => formulaFieldId, searchValue: 'WEBSITE REDESIGN' },
    ])('$label field search hides non-matching rows', async ({ getFieldId, searchValue }) => {
      const records = await expectSearchCount(
        projectsTableId,
        [searchValue, getFieldId(), true],
        1
      );
      expect(matchedProject(records)).toEqual(['Website Redesign']);
    });

    it.each([
      { label: 'link', searchValue: 'Alice Johnson' },
      { label: 'lookup', searchValue: 'Alice Johnson' },
      { label: 'rollup', searchValue: '100' },
      { label: 'formula', searchValue: 'WEBSITE REDESIGN' },
    ])(
      '$label value matches in a global search hiding non-matching rows',
      async ({ searchValue }) => {
        const records = await expectSearchCount(projectsTableId, [searchValue, '', true], 1);
        expect(matchedProject(records)).toEqual(['Website Redesign']);
      }
    );

    it('keeps all rows for a targeted search without hideNotMatchRow', async () => {
      await expectSearchCount(projectsTableId, ['Alice Johnson', linkFieldId, false], 2);
    });
  });

  // ------------------------------------------------------------------
  // Quoting regressions: uppercase / reserved-word db column names
  // v1: "search quoting regressions"
  // ------------------------------------------------------------------
  describe('search quoting regressions', () => {
    it('returns results when searching an uppercase / reserved db column', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Search Quoting Regression',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Description', type: 'singleLineText' },
          {
            name: 'Group',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'choAlpha', name: 'Alpha', color: 'blue' },
                { id: 'choBeta', name: 'Beta', color: 'green' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      const descriptionFieldId = table.fields.find((f) => f.name === 'Description')?.id ?? '';
      const groupFieldId = table.fields.find((f) => f.name === 'Group')?.id ?? '';

      await ctx.updateField({
        tableId: table.id,
        fieldId: descriptionFieldId,
        field: { dbFieldName: 'DESCRIPTION' },
      });
      await ctx.updateField({
        tableId: table.id,
        fieldId: groupFieldId,
        field: { dbFieldName: 'GROUP' },
      });

      await ctx.createRecords(table.id, [
        {
          fields: {
            [nameFieldId]: 'Alpha row',
            [descriptionFieldId]: 'ce target',
            [groupFieldId]: 'Alpha',
          },
        },
        {
          fields: {
            [nameFieldId]: 'Beta row',
            [descriptionFieldId]: 'other value',
            [groupFieldId]: 'Beta',
          },
        },
      ]);

      const records = await expectSearchCount(table.id, ['ce target', descriptionFieldId, true], 1);
      expect(records[0]?.fields[descriptionFieldId]).toBe('ce target');

      // Reserved-word select column stays searchable and sortable.
      const sorted = await listWithSearch(table.id, {
        search: ['row', nameFieldId, true],
        sort: [{ fieldId: groupFieldId, order: 'desc' }],
      });
      expect(sorted.map((record) => record.fields[nameFieldId])).toEqual(['Beta row', 'Alpha row']);
    });
  });

  describe('multi-condition filter plus mixed date search', () => {
    it('does not drop a category filter when date is one of several search fields', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Search Date And Filter',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Category', type: 'singleLineText' },
          {
            name: 'ShipDate',
            type: 'date',
            options: { formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' } },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const nameFieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';
      const categoryFieldId = table.fields.find((field) => field.name === 'Category')?.id ?? '';
      const dateFieldId = table.fields.find((field) => field.name === 'ShipDate')?.id ?? '';

      await ctx.createRecords(table.id, [
        {
          fields: {
            [nameFieldId]: 'today-match',
            [categoryFieldId]: 'Type7',
            [dateFieldId]: '2022-03-02T12:00:00.000Z',
          },
        },
        {
          fields: {
            [nameFieldId]: 'today-other',
            [categoryFieldId]: 'Type3',
            [dateFieldId]: '2022-03-02T12:00:00.000Z',
          },
        },
        {
          fields: {
            [nameFieldId]: 'other-match',
            [categoryFieldId]: 'Type7',
            [dateFieldId]: '2022-03-01T12:00:00.000Z',
          },
        },
      ]);

      const multiFilter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: dateFieldId,
            operator: 'is',
            value: {
              mode: 'exactDate',
              exactDate: '2022-03-02T00:00:00.000Z',
              timeZone: 'utc',
            },
          },
          { fieldId: categoryFieldId, operator: 'is', value: 'Type7' },
        ],
      };

      const filteredOnly = await listWithSearch(table.id, { filter: multiFilter });
      expect(filteredOnly.map((record) => record.fields[nameFieldId])).toEqual(['today-match']);

      const dateOnlySearch = await listWithSearch(table.id, {
        search: ['2022-03-02', dateFieldId, true],
        filter: multiFilter,
      });
      expect(dateOnlySearch.map((record) => record.fields[nameFieldId])).toEqual(['today-match']);

      const records = await listWithSearch(table.id, {
        search: ['2022-03-02', `${nameFieldId},${dateFieldId}`, true],
        filter: multiFilter,
      });
      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['today-match']);
    });
  });
});
