import { describe, expect, it } from 'vitest';

import { parseDataQueryManifest } from './DataQueryManifest';
import { collectDataQueryManifestDependencies } from './DataQueryManifestDependencies';

const tableA = `tbl${'a'.repeat(16)}`;
const tableB = `tbl${'b'.repeat(16)}`;
const titleField = `fld${'1'.repeat(16)}`;
const statusField = `fld${'2'.repeat(16)}`;
const amountField = `fld${'3'.repeat(16)}`;
const otherField = `fld${'4'.repeat(16)}`;

const indexOf = (queries: Record<string, unknown>) =>
  collectDataQueryManifestDependencies(
    parseDataQueryManifest({ schemaVersion: 1, queries })._unsafeUnwrap()
  );

describe('manifest dependency index', () => {
  it('records projection, filter, sort and grouped aggregate usages per field', () => {
    const index = indexOf({
      listOpen: {
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableA,
          select: [
            { fieldId: titleField, alias: 'title' },
            { fieldId: statusField, alias: 'status' },
            { system: 'id', alias: 'id' },
          ],
          filter: { fieldId: statusField, operator: 'is', value: 'open' },
          sort: [{ fieldId: titleField, order: 'asc' }],
          page: { limit: 20 },
        },
      },
      totals: {
        definition: {
          version: 1,
          kind: 'aggregate',
          tableId: tableA,
          groupBy: [{ fieldId: statusField, alias: 'status' }],
          aggregates: [{ fieldId: amountField, statisticFunc: 'sum', alias: 'total' }],
        },
      },
    });

    expect(index.queries).toEqual([
      {
        queryId: 'listOpen',
        mode: 'structured',
        result: 'many',
        tableId: tableA,
        fields: [
          { fieldId: titleField, usages: ['projection', 'sort'] },
          { fieldId: statusField, usages: ['projection', 'filter'] },
        ],
        complete: true,
        transitiveDependencies: 'not-expanded',
      },
      {
        queryId: 'totals',
        mode: 'structured',
        result: 'many',
        tableId: tableA,
        fields: [
          { fieldId: statusField, usages: ['group'] },
          { fieldId: amountField, usages: ['aggregate'] },
        ],
        complete: true,
        transitiveDependencies: 'not-expanded',
      },
    ]);
    expect(index.tables).toEqual([
      {
        tableId: tableA,
        queryIds: ['listOpen', 'totals'],
        fields: [
          { fieldId: titleField, usages: ['projection', 'sort'], queryIds: ['listOpen'] },
          {
            fieldId: statusField,
            usages: ['projection', 'filter', 'group'],
            queryIds: ['listOpen', 'totals'],
          },
          { fieldId: amountField, usages: ['aggregate'], queryIds: ['totals'] },
        ],
      },
    ]);
    expect(index.summary).toEqual({
      queryCount: 2,
      structuredCount: 2,
      autoCount: 0,
      sqlQueryCount: 0,
      fieldCount: 3,
    });
    expect(index.incompleteQueryIds).toEqual([]);
  });

  it('counts nested, negated and field-to-field predicates', () => {
    const index = indexOf({
      complex: {
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableA,
          select: [{ fieldId: titleField, alias: 'title' }],
          filter: {
            conjunction: 'and',
            items: [
              {
                conjunction: 'or',
                items: [
                  { fieldId: statusField, operator: 'is', value: 'open' },
                  { fieldId: statusField, operator: 'is', value: 'closed' },
                ],
              },
              { not: { fieldId: amountField, operator: 'is', value: null } },
              {
                fieldId: amountField,
                operator: 'isGreater',
                value: { type: 'field', fieldId: otherField },
              },
            ],
          },
        },
      },
    });

    expect(index.tables[0]?.fields).toEqual([
      { fieldId: titleField, usages: ['projection'], queryIds: ['complex'] },
      { fieldId: statusField, usages: ['filter'], queryIds: ['complex'] },
      { fieldId: amountField, usages: ['filter'], queryIds: ['complex'] },
      { fieldId: otherField, usages: ['reference'], queryIds: ['complex'] },
    ]);
  });

  it('counts a same-table qualified reference but never attributes a foreign-table one', () => {
    const index = indexOf({
      qualified: {
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableA,
          select: [{ fieldId: titleField, alias: 'title' }],
          filter: {
            conjunction: 'and',
            items: [
              {
                fieldId: amountField,
                operator: 'isGreater',
                value: { type: 'field', fieldId: statusField, tableId: tableA },
              },
              {
                fieldId: amountField,
                operator: 'is',
                value: { type: 'field', fieldId: otherField, tableId: tableB },
              },
            ],
          },
        },
      },
    });

    expect(index.queries[0]?.fields).toEqual([
      { fieldId: titleField, usages: ['projection'] },
      { fieldId: statusField, usages: ['reference'] },
      { fieldId: amountField, usages: ['filter'] },
    ]);
    expect(index.tables).toEqual([
      {
        tableId: tableA,
        queryIds: ['qualified'],
        fields: [
          { fieldId: titleField, usages: ['projection'], queryIds: ['qualified'] },
          { fieldId: statusField, usages: ['reference'], queryIds: ['qualified'] },
          { fieldId: amountField, usages: ['filter'], queryIds: ['qualified'] },
        ],
      },
    ]);
    // Core's filter spec rejects a foreign-qualified reference, so it reads no
    // column of either table: it is not invented as a dependency.
    expect(
      index.tables.flatMap((table) => table.fields.map((field) => field.fieldId))
    ).not.toContain(otherField);
  });

  it('indexes every allow-listed target of a parameterized sort', () => {
    const index = indexOf({
      sorted: {
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableA,
          select: [{ fieldId: titleField, alias: 'title' }],
          parameters: { by: { type: 'string' }, dir: { type: 'string' } },
          sort: [
            {
              field: { type: 'parameter', name: 'by' },
              order: { type: 'parameter', name: 'dir' },
              allowed: [{ fieldId: statusField }, { system: 'id' }],
            },
          ],
        },
      },
    });

    expect(index.queries[0]?.fields).toEqual([
      { fieldId: titleField, usages: ['projection'] },
      { fieldId: statusField, usages: ['sort'] },
    ]);
    expect(index.queries[0]?.complete).toBe(true);
  });

  it('marks SQL paths incomplete instead of pretending their columns are known', () => {
    const index = indexOf({
      legacy: {
        mode: 'sql-query',
        fallback: { sql: 'SELECT "title" FROM "bseX"."table_a"', outputs: [{ alias: 'title' }] },
      },
      hybrid: {
        mode: 'auto',
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableB,
          select: [{ fieldId: titleField, alias: 'title' }],
        },
        fallback: {
          sql: 'SELECT "title" FROM "bseX"."table_b"',
          outputs: [{ alias: 'title' }],
        },
      },
    });

    expect(index.queries).toEqual([
      {
        queryId: 'hybrid',
        mode: 'auto',
        result: 'many',
        tableId: tableB,
        fields: [{ fieldId: titleField, usages: ['projection'] }],
        complete: false,
        transitiveDependencies: 'not-expanded',
      },
      {
        queryId: 'legacy',
        mode: 'sql-query',
        result: 'many',
        tableId: null,
        fields: [],
        complete: false,
        transitiveDependencies: 'not-expanded',
      },
    ]);
    expect(index.incompleteQueryIds).toEqual(['hybrid', 'legacy']);
    expect(index.summary).toEqual({
      queryCount: 2,
      structuredCount: 0,
      autoCount: 1,
      sqlQueryCount: 1,
      fieldCount: 1,
    });
  });

  it('treats a declared fallback as a reachable SQL path in default and structured mode', () => {
    const index = indexOf({
      implicit: {
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableA,
          select: [{ fieldId: titleField, alias: 'title' }],
        },
        fallback: {
          sql: 'SELECT "title" FROM "bseX"."table_a"',
          outputs: [{ alias: 'title' }],
        },
      },
      explicit: {
        mode: 'structured',
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableB,
          select: [{ fieldId: titleField, alias: 'title' }],
        },
        fallback: {
          sql: 'SELECT "title" FROM "bseX"."table_b"',
          outputs: [{ alias: 'title' }],
        },
      },
    });

    expect(
      index.queries.map(({ queryId, mode, complete }) => ({ queryId, mode, complete }))
    ).toEqual([
      { queryId: 'explicit', mode: 'structured', complete: false },
      { queryId: 'implicit', mode: 'structured', complete: false },
    ]);
    expect(index.incompleteQueryIds).toEqual(['explicit', 'implicit']);
    expect(index.summary.structuredCount).toBe(2);
  });

  it('keeps one table entry across queries and reports the one-result flag', () => {
    const index = indexOf({
      byId: {
        definition: {
          version: 1,
          kind: 'records',
          tableId: tableA,
          select: [{ fieldId: titleField, alias: 'title' }],
          parameters: { id: { type: 'string' } },
          recordId: { type: 'parameter', name: 'id' },
        },
        result: 'one',
      },
      countAll: {
        definition: {
          version: 1,
          kind: 'aggregate',
          tableId: tableA,
          aggregates: [{ fieldId: titleField, statisticFunc: 'count', alias: 'count' }],
        },
      },
    });

    expect(index.queries.map((query) => [query.queryId, query.result])).toEqual([
      ['byId', 'one'],
      ['countAll', 'many'],
    ]);
    expect(index.tables[0]?.fields).toEqual([
      {
        fieldId: titleField,
        usages: ['projection', 'aggregate'],
        queryIds: ['byId', 'countAll'],
      },
    ]);
  });

  it('indexes target tables and link fields for a v2 relation query', () => {
    const index = indexOf({
      joined: {
        definition: {
          version: 2,
          kind: 'records',
          tableId: tableA,
          relations: { owner: { linkFieldId: otherField, tableId: tableB } },
          select: [
            { fieldId: titleField, alias: 'title' },
            { source: 'owner', fieldId: statusField, alias: 'ownerName' },
          ],
        },
      },
    });

    expect(index.queries).toEqual([
      {
        queryId: 'joined',
        mode: 'structured',
        result: 'many',
        tableId: tableA,
        fields: [
          { fieldId: titleField, usages: ['projection'] },
          { fieldId: otherField, usages: ['relation'] },
        ],
        relations: [
          {
            alias: 'owner',
            tableId: tableB,
            fields: [{ fieldId: statusField, usages: ['projection'] }],
          },
        ],
        complete: true,
        transitiveDependencies: 'not-expanded',
      },
    ]);
    expect(index.tables).toEqual([
      {
        tableId: tableA,
        queryIds: ['joined'],
        fields: [
          { fieldId: titleField, usages: ['projection'], queryIds: ['joined'] },
          { fieldId: otherField, usages: ['relation'], queryIds: ['joined'] },
        ],
      },
      {
        tableId: tableB,
        queryIds: ['joined'],
        fields: [{ fieldId: statusField, usages: ['projection'], queryIds: ['joined'] }],
      },
    ]);
  });

  it('indexes target filters and source sorts against the joined table', () => {
    const index = indexOf({
      filteredJoin: {
        definition: {
          version: 2,
          kind: 'records',
          tableId: tableA,
          relations: {
            owner: {
              linkFieldId: otherField,
              tableId: tableB,
              filter: { fieldId: statusField, operator: 'is', value: 'open' },
            },
          },
          select: [
            { fieldId: titleField, alias: 'title' },
            { source: 'owner', fieldId: statusField, alias: 'status' },
          ],
          sort: [{ source: 'owner', fieldId: statusField, order: 'asc' }],
          page: { limit: 10 },
        },
      },
    });

    expect(index.queries[0]).toMatchObject({
      queryId: 'filteredJoin',
      fields: [
        { fieldId: titleField, usages: ['projection'] },
        { fieldId: otherField, usages: ['relation'] },
      ],
      relations: [
        {
          alias: 'owner',
          tableId: tableB,
          fields: [{ fieldId: statusField, usages: ['projection', 'filter', 'sort'] }],
        },
      ],
    });
    expect(index.tables.find((table) => table.tableId === tableB)?.fields).toEqual([
      {
        fieldId: statusField,
        usages: ['projection', 'filter', 'sort'],
        queryIds: ['filteredJoin'],
      },
    ]);
  });
});
