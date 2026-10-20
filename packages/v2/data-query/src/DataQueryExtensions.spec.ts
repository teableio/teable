import { describe, expect, it } from 'vitest';

import { DataQueryDefinition, dataQueryOptionalParameters } from './DataQueryDefinition';
import { generateAppQueryArtifacts } from './DataQueryManifestFiles';
import { queryExecutionResultSchema } from './queryExecutionProtocol';

const tableId = `tbl${'a'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const amountId = `fld${'b'.repeat(16)}`;
const sortableId = `fld${'c'.repeat(16)}`;
const records = {
  version: 1 as const,
  kind: 'records' as const,
  tableId,
  select: [{ fieldId: titleId, alias: 'title' }] as [{ fieldId: string; alias: string }],
};
const aggregate = {
  version: 1 as const,
  kind: 'aggregate' as const,
  tableId,
  groupBy: [{ fieldId: titleId, alias: 'bucket' }],
  aggregates: [{ fieldId: amountId, statisticFunc: 'count' as const, alias: 'count' }] as [
    { fieldId: string; statisticFunc: 'count'; alias: string },
  ],
};

describe('optional filter leaves', () => {
  const definition = (filter: unknown) =>
    DataQueryDefinition.create({ ...records, filter, parameters: { label: { type: 'string' } } });

  it('skips an absent parameter inside and/or and keeps the remaining predicates', () => {
    const optional = {
      fieldId: titleId,
      operator: 'is',
      value: { type: 'parameter', name: 'label' },
      optional: true,
    };
    const literal = { fieldId: amountId, operator: 'isGreaterEqual', value: 10 };
    const conjunction = definition({ conjunction: 'and', items: [literal, optional] });
    // A group with one surviving item stays a valid group; only empty groups disappear.
    expect(conjunction._unsafeUnwrap().bind({})._unsafeUnwrap().filter).toEqual({
      conjunction: 'and',
      items: [literal],
    });
    const disjunction = definition({ conjunction: 'or', items: [literal, optional] });
    expect(disjunction._unsafeUnwrap().bind({})._unsafeUnwrap().filter).toEqual({
      conjunction: 'or',
      items: [literal],
    });
    expect(disjunction._unsafeUnwrap().bind({ label: 'x' })._unsafeUnwrap().filter).toEqual({
      conjunction: 'or',
      items: [literal, { fieldId: titleId, operator: 'is', value: 'x' }],
    });
  });

  it('removes a group and a negation that only contained absent optional leaves', () => {
    const optional = {
      fieldId: titleId,
      operator: 'is',
      value: { type: 'parameter', name: 'label' },
      optional: true,
    };
    expect(
      definition({ conjunction: 'or', items: [optional] })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap().filter
    ).toBeUndefined();
    expect(
      definition({ not: optional })._unsafeUnwrap().bind({})._unsafeUnwrap().filter
    ).toBeUndefined();
    expect(
      definition({ not: optional })._unsafeUnwrap().bind({ label: 'x' })._unsafeUnwrap().filter
    ).toEqual({ not: { fieldId: titleId, operator: 'is', value: 'x' } });
  });

  it('treats false, zero and a literal null as values rather than absence', () => {
    const nullable = DataQueryDefinition.create({
      ...records,
      parameters: { flag: { type: 'boolean' }, minimum: { type: 'number' } },
      filter: {
        conjunction: 'and',
        items: [
          {
            fieldId: titleId,
            operator: 'is',
            value: { type: 'parameter', name: 'flag' },
            optional: true,
          },
          {
            fieldId: amountId,
            operator: 'isGreaterEqual',
            value: { type: 'parameter', name: 'minimum' },
            optional: true,
          },
        ],
      },
    })._unsafeUnwrap();
    expect(nullable.bind({ flag: false, minimum: 0 })._unsafeUnwrap().filter).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: titleId, operator: 'is', value: false },
        { fieldId: amountId, operator: 'isGreaterEqual', value: 0 },
      ],
    });
    const nullValue = DataQueryDefinition.create({
      ...records,
      parameters: { label: { type: 'string', nullable: true } },
      filter: {
        fieldId: titleId,
        operator: 'is',
        value: { type: 'parameter', name: 'label' },
        optional: true,
      },
    })._unsafeUnwrap();
    expect(nullValue.bind({ label: null })._unsafeUnwrap().filter).toEqual({
      fieldId: titleId,
      operator: 'is',
      value: null,
    });
    expect(
      DataQueryDefinition.create({
        ...records,
        parameters: { label: { type: 'string' } },
        filter: {
          fieldId: titleId,
          operator: 'is',
          value: { type: 'parameter', name: 'label' },
          optional: true,
        },
      })
        ._unsafeUnwrap()
        .bind({ label: null })
        .isErr()
    ).toBe(true);
  });

  it('fails closed for an explicitly empty array instead of silently dropping the predicate', () => {
    const definition = DataQueryDefinition.create({
      ...records,
      parameters: { labels: { type: 'string[]' } },
      filter: {
        fieldId: titleId,
        operator: 'isAnyOf',
        value: { type: 'parameter', name: 'labels' },
        optional: true,
      },
    })._unsafeUnwrap();
    expect(definition.bind({})._unsafeUnwrap().filter).toBeUndefined();
    expect(definition.bind({ labels: [] }).isErr()).toBe(true);
  });

  it('still requires parameters referenced by a required position and rejects optional literals', () => {
    expect(
      DataQueryDefinition.create({
        ...records,
        parameters: { label: { type: 'string' } },
        filter: { fieldId: titleId, operator: 'is', value: { type: 'parameter', name: 'label' } },
      })
        ._unsafeUnwrap()
        .bind({})
        .isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...records,
        filter: { fieldId: titleId, operator: 'is', value: 'x', optional: true },
      }).isErr()
    ).toBe(true);
  });

  it('leaves an existing parameterized request byte-for-byte unchanged', () => {
    const definition = DataQueryDefinition.create({
      ...records,
      parameters: { label: { type: 'string', default: 'fallback' } },
      filter: { fieldId: titleId, operator: 'is', value: { type: 'parameter', name: 'label' } },
    })._unsafeUnwrap();
    expect(definition.bind({})._unsafeUnwrap().filter).toEqual({
      fieldId: titleId,
      operator: 'is',
      value: 'fallback',
    });
    expect([...dataQueryOptionalParameters(definition.snapshot())]).toEqual([]);
  });
});

describe('parameterized sort', () => {
  const parameterized = (optional: boolean) => ({
    field: { type: 'parameter', name: 'by' },
    order: { type: 'parameter', name: 'dir' },
    allowed: [{ fieldId: sortableId }],
    ...(optional ? { optional: true } : {}),
  });

  it('binds an allow-listed field and order without emitting identifiers', () => {
    const query = DataQueryDefinition.create({
      ...records,
      parameters: { by: { type: 'string' }, dir: { type: 'string' } },
      sort: [parameterized(false)],
    })._unsafeUnwrap();
    expect(query.bind({ by: sortableId, dir: 'desc' })._unsafeUnwrap().sort).toEqual([
      { fieldId: sortableId, order: 'desc' },
    ]);
    expect(query.bind({ by: `fld${'z'.repeat(16)}`, dir: 'desc' }).isErr()).toBe(true);
    expect(query.bind({ by: sortableId, dir: 'sideways' }).isErr()).toBe(true);
    expect(query.bind({}).isErr()).toBe(true);
    expect(query.bind({ by: sortableId, dir: 'asc', extra: 1 }).isErr()).toBe(true);
  });

  it('skips an absent optional sort but rejects an undeclared or mistyped parameter', () => {
    const query = DataQueryDefinition.create({
      ...records,
      parameters: { by: { type: 'string' }, dir: { type: 'string' } },
      sort: [parameterized(true)],
    })._unsafeUnwrap();
    expect(query.bind({})._unsafeUnwrap().sort).toEqual([]);
    expect(
      DataQueryDefinition.create({
        ...records,
        parameters: { by: { type: 'string' } },
        sort: [{ ...parameterized(true), field: { type: 'parameter', name: 'missing' } }],
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...records,
        parameters: { by: { type: 'number' } },
        sort: [
          {
            field: { type: 'parameter', name: 'by' },
            order: 'asc',
            allowed: [{ fieldId: sortableId }],
            optional: true,
          },
        ],
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...records,
        parameters: { by: { type: 'string' } },
        sort: [
          {
            field: { type: 'parameter', name: 'by' },
            order: 'asc',
            allowed: [{ fieldId: sortableId }, { fieldId: sortableId }],
            optional: true,
          },
        ],
      }).isErr()
    ).toBe(true);
  });

  it('allows sorting by a field that is not projected, matching the literal sort contract', () => {
    const query = DataQueryDefinition.create({
      ...records,
      parameters: { by: { type: 'string' } },
      sort: [
        {
          field: { type: 'parameter', name: 'by' },
          order: 'asc',
          allowed: [{ fieldId: sortableId }],
          optional: true,
        },
      ],
    })._unsafeUnwrap();
    const snapshot = query.snapshot();
    expect(snapshot.kind).toBe('records');
    if (snapshot.kind !== 'records') throw new Error('Expected a records definition');
    expect(snapshot.select).toEqual([{ fieldId: titleId, alias: 'title' }]);
    expect(query.bind({ by: sortableId })._unsafeUnwrap().sort).toEqual([
      { fieldId: sortableId, order: 'asc' },
    ]);
  });
});

describe('aggregate output-alias sort', () => {
  it('accepts group and aggregate aliases and keeps group-field sorting', () => {
    for (const alias of ['bucket', 'count']) {
      const query = DataQueryDefinition.create({
        ...aggregate,
        sort: [{ alias, order: 'desc' }],
      })._unsafeUnwrap();
      expect(query.bind({})._unsafeUnwrap().sort).toEqual([{ alias, order: 'desc' }]);
    }
    expect(
      DataQueryDefinition.create({
        ...aggregate,
        sort: [{ fieldId: titleId, order: 'asc' }],
      })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap().sort
    ).toEqual([{ fieldId: titleId, order: 'asc' }]);
    expect(
      DataQueryDefinition.create({
        ...aggregate,
        sort: [{ alias: 'missing', order: 'asc' }],
      }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({ ...records, sort: [{ alias: 'title', order: 'asc' }] }).isErr()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({ ...aggregate, sort: [{ system: 'id', order: 'asc' }] }).isErr()
    ).toBe(true);
  });
});

describe('same-request page total', () => {
  it('is opt-in and never changes pagination bounds', () => {
    expect(
      DataQueryDefinition.create(records)._unsafeUnwrap().bind({})._unsafeUnwrap().includeTotal
    ).toBe(false);
    const query = DataQueryDefinition.create({
      ...records,
      page: { limit: 2, offset: 5, includeTotal: true },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    expect(query).toMatchObject({ limit: 2, offset: 5, includeTotal: true });
    expect(
      queryExecutionResultSchema.safeParse({
        rows: [],
        page: { limit: 2, offset: 5, total: 11 },
      }).success
    ).toBe(true);
    expect(queryExecutionResultSchema.safeParse({ rows: [] }).success).toBe(true);
    expect(
      queryExecutionResultSchema.safeParse({ rows: [], page: { limit: 2, offset: 5 } }).success
    ).toBe(false);
  });
});

describe('array-distinct projection contract', () => {
  it('is available on field projections only', () => {
    expect(
      DataQueryDefinition.create({
        ...records,
        select: [{ fieldId: titleId, alias: 'title', arrayDistinct: true }],
      }).isOk()
    ).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...records,
        select: [{ system: 'id', alias: 'id', arrayDistinct: true }],
      }).isErr()
    ).toBe(true);
  });
});

describe('generated client parameter optionality and page result', () => {
  it('marks optional-only parameters optional and returns rows plus page', () => {
    const generated = generateAppQueryArtifacts({
      schemaVersion: 1,
      queries: {
        search: {
          result: 'many',
          definition: {
            ...records,
            parameters: { label: { type: 'string' }, required: { type: 'string' } },
            filter: {
              conjunction: 'and',
              items: [
                {
                  fieldId: titleId,
                  operator: 'is',
                  value: { type: 'parameter', name: 'label' },
                  optional: true,
                },
                {
                  fieldId: amountId,
                  operator: 'is',
                  value: { type: 'parameter', name: 'required' },
                },
              ],
            },
            page: { limit: 10, includeTotal: true },
          },
        },
        plain: {
          result: 'many',
          definition: { ...records },
        },
      },
    })._unsafeUnwrap().module;
    expect(generated).toContain('"label"?: string;');
    expect(generated).toContain('"required": string;');
    expect(generated).toContain('QueryPageResult<QueryRows["search"]>');
    expect(generated).toContain('Array<QueryRows["plain"]>');
    expect(generated).toContain('execute("search", parameters, false, true)');
    expect(generated).toContain('execute("plain", parameters, false) as unknown as Promise<');
    expect(generated).not.toContain('QueryPageResult<QueryRows["plain"]>');
  });

  it('keeps the legacy generated module free of new-client constructs', () => {
    const generated = generateAppQueryArtifacts({
      schemaVersion: 1,
      queries: {
        legacy: { result: 'many', definition: { ...records } },
        legacyOne: {
          result: 'one',
          definition: { ...records, recordId: `rec${'d'.repeat(16)}` },
        },
      },
    })._unsafeUnwrap().module;
    for (const token of ['QueryPage', 'withPage', 'as unknown as']) {
      expect(generated).not.toContain(token);
    }
    expect(generated).toContain(
      'Promise<Array<QueryRows["legacy"]>> => execute("legacy", parameters, false)'
    );
  });
});
