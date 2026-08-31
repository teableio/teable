/* eslint-disable @typescript-eslint/naming-convention */
import { listTableRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { FieldKeyType } from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * v1-parity listRecords sort coverage.
 *
 * v1 references:
 * - apps/nestjs-backend/test/comprehensive-field-sort.e2e-spec.ts
 * - apps/nestjs-backend/test/sort.e2e-spec.ts
 *
 * Semantics under test (T6520):
 * - cleared/blank cells are stored as null; ASC places nulls first, DESC
 *   places nulls last (v1 parity, see StoredTableRecordQueryBuilder).
 * - unchecked checkbox (false) is normalized to null on write and therefore
 *   sorts with the null bucket.
 * - single/multiple select (and select lookups) sort by choice order, using
 *   the first element for multi-value cells.
 * - user/link cells sort by title.
 * - date fields with time formatting `None` sort at day/month/year precision
 *   depending on the date preset (ties broken by __auto_number ASC).
 * - query sort takes precedence over view default sort; view sort keys not
 *   present in the query sort are appended after it.
 *
 * Related coverage:
 * - view sort PUT round-trip / clear with null → covered by
 *   viewOperations.e2e.spec.ts ("round-trips filter, sort, and group").
 * - x_20 lookup "Multiple CellValueType" oracle tests → covered below with
 *   deterministic multi-element values that distinguish display-key ordering
 *   from raw jsonb ordering.
 */
describe('v2 listRecords sort (e2e)', () => {
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
  // Comprehensive per-field-type sorting fixture
  // v1: comprehensive-field-sort.e2e-spec.ts
  // 4 records; r4 is the all-null row.
  // ------------------------------------------------------------------
  describe('per field type sorting', () => {
    let tableId: string;
    let nameFieldId: string;
    let textFieldId: string;
    let numberFieldId: string;
    let dateFieldId: string;
    let checkboxFieldId: string;
    let selectFieldId: string;
    let tagsFieldId: string;
    let ratingFieldId: string;
    let linkFieldId: string;
    let formulaFieldId: string;
    let rollupFieldId: string;
    let lookupTextFieldId: string;
    let lookupNumberFieldId: string;

    const namesFor = async (
      sort: Array<{ fieldId: string; order: 'asc' | 'desc' }>
    ): Promise<Array<unknown>> => {
      const records = await listOrdered(tableId, { sort });
      expect(records).toHaveLength(4);
      return records.map((record) => record.fields[nameFieldId]);
    };

    beforeAll(async () => {
      const relatedTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Related',
        fields: [
          { name: 'Related Text', type: 'singleLineText', isPrimary: true },
          { name: 'Related Number', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      const relatedTextFieldId = relatedTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const relatedNumberFieldId =
        relatedTable.fields.find((f) => f.name === 'Related Number')?.id ?? '';
      const relatedAlpha = await ctx.createRecord(relatedTable.id, {
        [relatedTextFieldId]: 'Alpha',
        [relatedNumberFieldId]: 100,
      });
      const relatedBeta = await ctx.createRecord(relatedTable.id, {
        [relatedTextFieldId]: 'Beta',
        [relatedNumberFieldId]: 200,
      });
      const relatedGamma = await ctx.createRecord(relatedTable.id, {
        [relatedTextFieldId]: 'Gamma',
        [relatedNumberFieldId]: 300,
      });

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Main',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
          {
            name: 'Number',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 2 } },
          },
          { name: 'Date', type: 'date' },
          { name: 'Check', type: 'checkbox' },
          {
            name: 'Select',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'opt1', name: 'High', color: 'red' },
                { id: 'opt2', name: 'Medium', color: 'blue' },
                { id: 'opt3', name: 'Low', color: 'green' },
              ],
            },
          },
          {
            name: 'Tags',
            type: 'multipleSelect',
            options: {
              choices: [
                { id: 'tag1', name: 'Urgent', color: 'red' },
                { id: 'tag2', name: 'Important', color: 'blue' },
                { id: 'tag3', name: 'Normal', color: 'green' },
              ],
            },
          },
          {
            name: 'Rating',
            type: 'rating',
            options: { max: 5, icon: 'star', color: 'yellowBright' },
          },
          {
            name: 'Link',
            type: 'link',
            options: {
              relationship: 'manyOne',
              foreignTableId: relatedTable.id,
              lookupFieldId: relatedTextFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      textFieldId = table.fields.find((f) => f.name === 'Text')?.id ?? '';
      numberFieldId = table.fields.find((f) => f.name === 'Number')?.id ?? '';
      dateFieldId = table.fields.find((f) => f.name === 'Date')?.id ?? '';
      checkboxFieldId = table.fields.find((f) => f.name === 'Check')?.id ?? '';
      selectFieldId = table.fields.find((f) => f.name === 'Select')?.id ?? '';
      tagsFieldId = table.fields.find((f) => f.name === 'Tags')?.id ?? '';
      ratingFieldId = table.fields.find((f) => f.name === 'Rating')?.id ?? '';
      linkFieldId = table.fields.find((f) => f.name === 'Link')?.id ?? '';

      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'Doubled',
          options: { expression: `{${numberFieldId}} * 2` },
        },
      });
      formulaFieldId = withFormula.fields.find((f) => f.name === 'Doubled')?.id ?? '';

      const withRollup = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'rollup',
          name: 'Rollup Sum',
          options: { expression: 'sum({values})' },
          config: {
            foreignTableId: relatedTable.id,
            lookupFieldId: relatedNumberFieldId,
            linkFieldId,
          },
        },
      });
      rollupFieldId = withRollup.fields.find((f) => f.name === 'Rollup Sum')?.id ?? '';

      const withLookupText = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'lookup',
          name: 'Lookup Text',
          options: {
            foreignTableId: relatedTable.id,
            lookupFieldId: relatedTextFieldId,
            linkFieldId,
          },
        },
      });
      lookupTextFieldId = withLookupText.fields.find((f) => f.name === 'Lookup Text')?.id ?? '';

      const withLookupNumber = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'lookup',
          name: 'Lookup Number',
          options: {
            foreignTableId: relatedTable.id,
            lookupFieldId: relatedNumberFieldId,
            linkFieldId,
          },
        },
      });
      lookupNumberFieldId =
        withLookupNumber.fields.find((f) => f.name === 'Lookup Number')?.id ?? '';

      await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 'r1',
            [textFieldId]: 'Charlie',
            [numberFieldId]: 30.5,
            [dateFieldId]: '2024-03-15T12:00:00.000Z',
            [checkboxFieldId]: true,
            [selectFieldId]: 'High',
            [tagsFieldId]: ['Urgent', 'Important'],
            [ratingFieldId]: 5,
            [linkFieldId]: { id: relatedGamma.id },
          },
        },
        {
          fields: {
            [nameFieldId]: 'r2',
            [textFieldId]: 'Alpha',
            [numberFieldId]: 10.25,
            [dateFieldId]: '2024-01-10T12:00:00.000Z',
            // false is normalized to null on write (T6520): sorts as unchecked/null.
            [checkboxFieldId]: false,
            [selectFieldId]: 'Low',
            [tagsFieldId]: ['Normal'],
            [ratingFieldId]: 2,
            [linkFieldId]: { id: relatedAlpha.id },
          },
        },
        {
          fields: {
            [nameFieldId]: 'r3',
            [textFieldId]: 'Beta',
            [numberFieldId]: 20.75,
            [dateFieldId]: '2024-02-20T12:00:00.000Z',
            [checkboxFieldId]: null,
            [selectFieldId]: 'Medium',
            [tagsFieldId]: ['Important', 'Normal'],
            [ratingFieldId]: 4,
            [linkFieldId]: { id: relatedBeta.id },
          },
        },
        { fields: { [nameFieldId]: 'r4' } },
      ]);
    }, 120000);

    it('text sorts ascending A-Z with nulls first', async () => {
      expect(await namesFor([{ fieldId: textFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('text sorts descending Z-A with nulls last', async () => {
      expect(await namesFor([{ fieldId: textFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r3',
        'r2',
        'r4',
      ]);
    });

    it('number sorts ascending low to high with nulls first', async () => {
      expect(await namesFor([{ fieldId: numberFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('number sorts descending high to low with nulls last', async () => {
      expect(await namesFor([{ fieldId: numberFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r3',
        'r2',
        'r4',
      ]);
    });

    it('date sorts ascending earliest to latest with nulls first', async () => {
      expect(await namesFor([{ fieldId: dateFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('date sorts descending latest to earliest with nulls last', async () => {
      expect(await namesFor([{ fieldId: dateFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r3',
        'r2',
        'r4',
      ]);
    });

    it('checkbox sorts ascending with unchecked (false/null) first and true last', async () => {
      // r2 was written as false but is stored as null (T6520): it stays in the
      // unchecked bucket, ordered among nulls by __auto_number.
      expect(await namesFor([{ fieldId: checkboxFieldId, order: 'asc' }])).toEqual([
        'r2',
        'r3',
        'r4',
        'r1',
      ]);
    });

    it('checkbox sorts descending with true first and unchecked last', async () => {
      expect(await namesFor([{ fieldId: checkboxFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r2',
        'r3',
        'r4',
      ]);
    });

    it('single select sorts ascending by choice order (High, Medium, Low)', async () => {
      expect(await namesFor([{ fieldId: selectFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r1',
        'r3',
        'r2',
      ]);
    });

    it('single select sorts descending by reversed choice order', async () => {
      expect(await namesFor([{ fieldId: selectFieldId, order: 'desc' }])).toEqual([
        'r2',
        'r3',
        'r1',
        'r4',
      ]);
    });

    it('multiple select sorts ascending by first-choice order', async () => {
      // First choices: r1 Urgent(1), r3 Important(2), r2 Normal(3).
      expect(await namesFor([{ fieldId: tagsFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r1',
        'r3',
        'r2',
      ]);
    });

    it('multiple select sorts descending by reversed first-choice order', async () => {
      expect(await namesFor([{ fieldId: tagsFieldId, order: 'desc' }])).toEqual([
        'r2',
        'r3',
        'r1',
        'r4',
      ]);
    });

    it('rating sorts ascending with nulls first', async () => {
      expect(await namesFor([{ fieldId: ratingFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('rating sorts descending with nulls last', async () => {
      expect(await namesFor([{ fieldId: ratingFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r3',
        'r2',
        'r4',
      ]);
    });

    it('formula sorts ascending (blank input evaluates to 0, v1 parity)', async () => {
      // Doubled: r1 61, r2 20.5, r3 41.5, r4 {blank}*2 = 0.
      expect(await namesFor([{ fieldId: formulaFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('formula sorts descending', async () => {
      expect(await namesFor([{ fieldId: formulaFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r3',
        'r2',
        'r4',
      ]);
    });

    it('link sorts ascending by linked title with nulls first', async () => {
      // Titles: r1 Gamma, r2 Alpha, r3 Beta, r4 null.
      expect(await namesFor([{ fieldId: linkFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('rollup sum sorts ascending (unlinked row rolls up to 0, v1 parity)', async () => {
      expect(await namesFor([{ fieldId: rollupFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('rollup sum sorts descending', async () => {
      expect(await namesFor([{ fieldId: rollupFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r3',
        'r2',
        'r4',
      ]);
    });

    it('lookup text sorts ascending with nulls first', async () => {
      expect(await namesFor([{ fieldId: lookupTextFieldId, order: 'asc' }])).toEqual([
        'r4',
        'r2',
        'r3',
        'r1',
      ]);
    });

    it('lookup number sorts descending with nulls last', async () => {
      expect(await namesFor([{ fieldId: lookupNumberFieldId, order: 'desc' }])).toEqual([
        'r1',
        'r3',
        'r2',
        'r4',
      ]);
    });
  });

  // ------------------------------------------------------------------
  // Multi-key sort
  // v1: comprehensive-field-sort "Multiple Field Sorting"
  // ------------------------------------------------------------------
  describe('multi-key sort', () => {
    let tableId: string;
    let nameFieldId: string;
    let catFieldId: string;
    let valFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Multi Key',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'Cat', type: 'singleLineText' },
          { name: 'Val', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      catFieldId = table.fields.find((f) => f.name === 'Cat')?.id ?? '';
      valFieldId = table.fields.find((f) => f.name === 'Val')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'n1', [catFieldId]: 'B', [valFieldId]: 1 } },
        { fields: { [nameFieldId]: 'n2', [catFieldId]: 'A', [valFieldId]: 2 } },
        { fields: { [nameFieldId]: 'n3', [catFieldId]: 'A', [valFieldId]: 1 } },
        { fields: { [nameFieldId]: 'n4', [valFieldId]: 5 } },
      ]);
    }, 60000);

    it('sorts by primary key ascending and secondary key descending', async () => {
      const records = await listOrdered(tableId, {
        sort: [
          { fieldId: catFieldId, order: 'asc' },
          { fieldId: valFieldId, order: 'desc' },
        ],
      });
      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['n4', 'n2', 'n3', 'n1']);
    });
  });

  // ------------------------------------------------------------------
  // Multiple select with "?" in choice names
  // v1: comprehensive-field-sort "Multiple Select Sorting with Question Mark Choices"
  // ------------------------------------------------------------------
  describe('multiple select with question mark choices', () => {
    let tableId: string;
    let tagFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Question Mark Tags',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Special',
            type: 'multipleSelect',
            options: {
              choices: [
                { id: 'opt-a', name: 'Alpha?' },
                { id: 'opt-b', name: 'Beta' },
                { id: 'opt-c', name: 'Gamma' },
              ],
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      tagFieldId = table.fields.find((f) => f.name === 'Special')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [tagFieldId]: ['Beta'] } },
        { fields: { [tagFieldId]: ['Alpha?'] } },
        { fields: { [tagFieldId]: ['Gamma'] } },
        { fields: {} },
      ]);
    }, 60000);

    const firstChoices = (records: Array<{ fields: Record<string, unknown> }>) =>
      records.map((record) => {
        const value = record.fields[tagFieldId] as string[] | null | undefined;
        return value?.[0] ?? null;
      });

    it('sorts ascending by choice order with nulls first even when choices contain "?"', async () => {
      const records = await listOrdered(tableId, {
        sort: [{ fieldId: tagFieldId, order: 'asc' }],
      });
      expect(firstChoices(records)).toEqual([null, 'Alpha?', 'Beta', 'Gamma']);
    });

    it('sorts descending by reversed choice order with nulls last', async () => {
      const records = await listOrdered(tableId, {
        sort: [{ fieldId: tagFieldId, order: 'desc' }],
      });
      expect(firstChoices(records)).toEqual(['Gamma', 'Beta', 'Alpha?', null]);
    });
  });

  // ------------------------------------------------------------------
  // Multi-value lookup sorting
  // v1: sort.e2e-spec "OpenAPI Sort (e2e) Multiple CellValueType"
  // ------------------------------------------------------------------
  describe('multi-value lookup sort', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    const lookupFieldIds: Record<'string' | 'number' | 'date' | 'boolean', string> = {
      string: '',
      number: '',
      date: '',
      boolean: '',
    };

    const cases = [
      {
        valueType: 'string' as const,
        asc: ['t3', 't1', 't2'],
        desc: ['t1', 't2', 't3'],
      },
      {
        valueType: 'number' as const,
        asc: ['t3', 't2', 't1'],
        desc: ['t1', 't2', 't3'],
      },
      {
        valueType: 'date' as const,
        asc: ['t3', 't2', 't1'],
        desc: ['t1', 't2', 't3'],
      },
      {
        valueType: 'boolean' as const,
        asc: ['t3', 't1', 't2'],
        desc: ['t1', 't2', 't3'],
      },
    ];

    const namesFor = async (
      fieldId: string,
      order: 'asc' | 'desc',
      options: { viewId?: string } = {}
    ) => {
      const records = await listOrdered(tableId, {
        ...options,
        ...(options.viewId ? {} : { sort: [{ fieldId, order }] }),
      });
      return records.map((record) => record.fields[nameFieldId]);
    };

    const setViewSort = async (fieldId: string, order: 'asc' | 'desc') => {
      const response = await fetch(`${ctx.baseUrl}/tables/updateViewSort`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          viewId,
          sort: { sortObjs: [{ fieldId, order }], manualSort: false },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true });
    };

    beforeAll(async () => {
      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Lookup Source',
        fields: [
          { name: 'Title', type: 'singleLineText', isPrimary: true },
          { name: 'Text', type: 'singleLineText' },
          {
            name: 'Amount',
            type: 'number',
            options: { formatting: { type: 'decimal', precision: 1 } },
          },
          {
            name: 'Due',
            type: 'date',
            options: {
              formatting: { date: 'M/D/YYYY', time: 'None', timeZone: 'utc' },
            },
          },
          { name: 'Checked', type: 'checkbox' },
        ],
        views: [{ type: 'grid' }],
      });
      const titleFieldId = sourceTable.fields.find((f) => f.isPrimary)?.id ?? '';
      const textFieldId = sourceTable.fields.find((f) => f.name === 'Text')?.id ?? '';
      const amountFieldId = sourceTable.fields.find((f) => f.name === 'Amount')?.id ?? '';
      const dueFieldId = sourceTable.fields.find((f) => f.name === 'Due')?.id ?? '';
      const checkedFieldId = sourceTable.fields.find((f) => f.name === 'Checked')?.id ?? '';
      const [sourceA, sourceB, sourceC] = await ctx.createRecords(sourceTable.id, [
        {
          fields: {
            [titleFieldId]: 'A',
            [textFieldId]: 'Beta',
            [amountFieldId]: 2,
            [dueFieldId]: '2025-01-01T00:00:00.000Z',
            [checkedFieldId]: true,
          },
        },
        {
          fields: {
            [titleFieldId]: 'B',
            [textFieldId]: 'Zulu',
            [amountFieldId]: 9,
            [dueFieldId]: '2025-02-01T00:00:00.000Z',
            [checkedFieldId]: true,
          },
        },
        {
          fields: {
            [titleFieldId]: 'C',
            [textFieldId]: 'Alpha',
            [amountFieldId]: 10,
            [dueFieldId]: '2026-01-01T00:00:00.000Z',
          },
        },
      ]);

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Lookup Target',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Link',
            type: 'link',
            options: {
              relationship: 'manyMany',
              foreignTableId: sourceTable.id,
              lookupFieldId: titleFieldId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      viewId = table.views[0]?.id ?? '';
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      const linkFieldId = table.fields.find((f) => f.name === 'Link')?.id ?? '';

      for (const [valueType, sourceFieldId] of [
        ['string', textFieldId],
        ['number', amountFieldId],
        ['date', dueFieldId],
        ['boolean', checkedFieldId],
      ] as const) {
        const fieldName = `Lookup ${valueType}`;
        const result = await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'lookup',
            name: fieldName,
            options: {
              foreignTableId: sourceTable.id,
              lookupFieldId: sourceFieldId,
              linkFieldId,
            },
          },
        });
        lookupFieldIds[valueType] = result.fields.find((f) => f.name === fieldName)?.id ?? '';
      }

      await ctx.createRecords(tableId, [
        {
          fields: {
            [nameFieldId]: 't1',
            [linkFieldId]: [{ id: sourceA.id }, { id: sourceB.id }],
          },
        },
        {
          fields: {
            [nameFieldId]: 't2',
            [linkFieldId]: [{ id: sourceA.id }, { id: sourceC.id }],
          },
        },
        { fields: { [nameFieldId]: 't3' } },
      ]);
    }, 120000);

    it.each(cases)('sorts $valueType lookup arrays through query sort', async (testCase) => {
      const fieldId = lookupFieldIds[testCase.valueType];
      expect(await namesFor(fieldId, 'asc')).toEqual(testCase.asc);
      expect(await namesFor(fieldId, 'desc')).toEqual(testCase.desc);
    });

    it.each(cases)('sorts $valueType lookup arrays through view sort', async (testCase) => {
      const fieldId = lookupFieldIds[testCase.valueType];
      for (const order of ['asc', 'desc'] as const) {
        await setViewSort(fieldId, order);
        expect(await namesFor(fieldId, order, { viewId })).toEqual(testCase[order]);
      }
    });
  });

  // ------------------------------------------------------------------
  // View default sort vs query sort precedence
  // v1: sort.e2e-spec "view sort property should be merged after by
  // interface parameter orderBy"
  // ------------------------------------------------------------------
  describe('view default sort vs query sort', () => {
    let tableId: string;
    let viewId: string;
    let nameFieldId: string;
    let aFieldId: string;
    let bFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort View Defaults',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          { name: 'A', type: 'number' },
          { name: 'B', type: 'number' },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      viewId = table.views[0]?.id ?? '';
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      aFieldId = table.fields.find((f) => f.name === 'A')?.id ?? '';
      bFieldId = table.fields.find((f) => f.name === 'B')?.id ?? '';

      await ctx.createRecords(tableId, [
        { fields: { [nameFieldId]: 'n1', [aFieldId]: 1, [bFieldId]: 1 } },
        { fields: { [nameFieldId]: 'n2', [aFieldId]: 2, [bFieldId]: 1 } },
        { fields: { [nameFieldId]: 'n3', [aFieldId]: 1, [bFieldId]: 2 } },
        { fields: { [nameFieldId]: 'n4', [aFieldId]: 2, [bFieldId]: 2 } },
      ]);

      const sorted = await client.tables.updateViewSort({
        tableId,
        viewId,
        sort: { sortObjs: [{ fieldId: aFieldId, order: 'asc' }], manualSort: false },
      });
      expect(sorted.ok).toBe(true);
    }, 60000);

    it('applies the view default sort when listing with viewId only', async () => {
      const records = await listOrdered(tableId, { viewId });
      // A asc, ties broken by view row order / __auto_number.
      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['n1', 'n3', 'n2', 'n4']);
    });

    it('puts the query sort before the view default sort', async () => {
      const records = await listOrdered(tableId, {
        viewId,
        sort: [{ fieldId: bFieldId, order: 'desc' }],
      });
      // B desc first, then view default A asc as secondary key.
      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['n3', 'n4', 'n1', 'n2']);
    });

    it('lets the query sort override the view default order for the same field', async () => {
      const records = await listOrdered(tableId, {
        viewId,
        sort: [{ fieldId: aFieldId, order: 'desc' }],
      });
      expect(records.map((record) => record.fields[nameFieldId])).toEqual(['n2', 'n4', 'n1', 'n3']);
    });
  });

  // ------------------------------------------------------------------
  // Date formatting sort precision (time: None)
  // v1: sort.e2e-spec "OpenAPI Sort (e2e) Date Formatting"
  // ------------------------------------------------------------------
  describe('date formatting sort precision', () => {
    let tableId: string;
    let nameFieldId: string;
    let yearFieldId: string;
    let monthFieldId: string;
    let dayFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Date Formatting',
        fields: [
          { name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            name: 'Year',
            type: 'date',
            options: { formatting: { date: 'YYYY', time: 'None', timeZone: 'Asia/Singapore' } },
          },
          {
            name: 'Month',
            type: 'date',
            options: { formatting: { date: 'YYYY-MM', time: 'None', timeZone: 'Asia/Singapore' } },
          },
          {
            name: 'Day',
            type: 'date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'Asia/Singapore' },
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';
      yearFieldId = table.fields.find((f) => f.name === 'Year')?.id ?? '';
      monthFieldId = table.fields.find((f) => f.name === 'Month')?.id ?? '';
      dayFieldId = table.fields.find((f) => f.name === 'Day')?.id ?? '';

      // UTC 04:00 = 12:00 in Asia/Singapore: same calendar date in both zones.
      const instants: Array<[string, string]> = [
        ['r1', '2024-01-10T04:00:00.000Z'],
        ['r2', '2024-01-10T02:00:00.000Z'],
        ['r3', '2023-05-01T04:00:00.000Z'],
        ['r4', '2022-08-01T04:00:00.000Z'],
        ['r5', '2022-05-01T04:00:00.000Z'],
        ['r6', '2024-01-01T04:00:00.000Z'],
      ];
      await ctx.createRecords(
        tableId,
        instants.map(([name, iso]) => ({
          fields: {
            [nameFieldId]: name,
            [yearFieldId]: iso,
            [monthFieldId]: iso,
            [dayFieldId]: iso,
          },
        }))
      );
    }, 60000);

    const namesFor = async (fieldId: string, order: 'asc' | 'desc') => {
      const records = await listOrdered(tableId, { sort: [{ fieldId, order }] });
      return records.map((record) => record.fields[nameFieldId]);
    };

    it('YYYY preset sorts at year precision with __auto_number tie-break', async () => {
      expect(await namesFor(yearFieldId, 'asc')).toEqual(['r4', 'r5', 'r3', 'r1', 'r2', 'r6']);
      expect(await namesFor(yearFieldId, 'desc')).toEqual(['r1', 'r2', 'r6', 'r3', 'r4', 'r5']);
    });

    it('YYYY-MM preset sorts at month precision with __auto_number tie-break', async () => {
      expect(await namesFor(monthFieldId, 'asc')).toEqual(['r5', 'r4', 'r3', 'r1', 'r2', 'r6']);
      expect(await namesFor(monthFieldId, 'desc')).toEqual(['r1', 'r2', 'r6', 'r3', 'r4', 'r5']);
    });

    it('YYYY-MM-DD preset sorts at day precision (same-day rows keep insert order in both directions)', async () => {
      expect(await namesFor(dayFieldId, 'asc')).toEqual(['r5', 'r4', 'r3', 'r6', 'r1', 'r2']);
      expect(await namesFor(dayFieldId, 'desc')).toEqual(['r1', 'r2', 'r6', 'r3', 'r4', 'r5']);
    });
  });

  // ------------------------------------------------------------------
  // Created time precision
  // v1: sort.e2e-spec "sort date should always use a second precision when
  // formatting time is not none" / "precision should be day when time is none"
  // ------------------------------------------------------------------
  describe('created time sort precision', () => {
    let tableId: string;
    let nameFieldId: string;
    let timedFieldId: string;
    let dayFieldId: string;

    beforeAll(async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Created Time',
        fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      tableId = table.id;
      nameFieldId = table.fields.find((f) => f.name === 'Name')?.id ?? '';

      await ctx.createRecord(tableId, { [nameFieldId]: 'first' });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await ctx.createRecord(tableId, { [nameFieldId]: 'second' });

      const withTimed = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'createdTime',
          name: 'Created Timed',
          options: { formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' } },
        },
      });
      timedFieldId = withTimed.fields.find((f) => f.name === 'Created Timed')?.id ?? '';

      const withDay = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'createdTime',
          name: 'Created Day',
          options: { formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' } },
        },
      });
      dayFieldId = withDay.fields.find((f) => f.name === 'Created Day')?.id ?? '';
    }, 60000);

    it('uses full timestamp precision when time formatting is not None', async () => {
      const asc = await listOrdered(tableId, { sort: [{ fieldId: timedFieldId, order: 'asc' }] });
      const desc = await listOrdered(tableId, { sort: [{ fieldId: timedFieldId, order: 'desc' }] });
      expect(asc.map((record) => record.fields[nameFieldId])).toEqual(['first', 'second']);
      expect(desc.map((record) => record.fields[nameFieldId])).toEqual(['second', 'first']);
    });

    it('uses day precision when time formatting is None (desc equals asc via tie-break)', async () => {
      const asc = await listOrdered(tableId, { sort: [{ fieldId: dayFieldId, order: 'asc' }] });
      const desc = await listOrdered(tableId, { sort: [{ fieldId: dayFieldId, order: 'desc' }] });
      expect(asc.map((record) => record.fields[nameFieldId])).toEqual(['first', 'second']);
      expect(desc.map((record) => record.fields[nameFieldId])).toEqual(['first', 'second']);
    });
  });

  // ------------------------------------------------------------------
  // Button field cannot be used in view sort
  // v1: sort.e2e-spec "should not allow to modify sort for button field"
  // ------------------------------------------------------------------
  describe('view sort validation', () => {
    it('rejects updating a view sort with a button field', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Sort Button Reject',
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
        client.tables.updateViewSort({
          tableId: table.id,
          viewId: table.views[0]?.id ?? '',
          sort: { sortObjs: [{ fieldId: buttonFieldId, order: 'asc' }], manualSort: false },
        })
      ).rejects.toThrow(/unsupported Button type/);
    });
  });
});
