import { describe, expect, it } from 'vitest';

import { DataQueryDefinition } from './DataQueryDefinition';
import { dataQueryManifestSchema, parseDataQueryManifest } from './DataQueryManifest';

const definition = {
  version: 1,
  kind: 'records',
  tableId: `tbl${'a'.repeat(16)}`,
  select: [{ system: 'id', alias: 'id' }],
};
const recordId = `rec${'b'.repeat(16)}`;

describe('canonical named query manifest', () => {
  it('keeps format version distinct and accepts many by default or targeted one', () => {
    const manifest = {
      schemaVersion: 1,
      queries: {
        getTodos: { definition },
        getTodoById: {
          definition: {
            ...definition,
            recordId: { type: 'parameter', name: 'id' },
            parameters: { id: { type: 'string' } },
          },
          result: 'one',
        },
      },
    };
    expect(parseDataQueryManifest(manifest).isOk()).toBe(true);
    expect(Object.isFrozen(parseDataQueryManifest(manifest)._unsafeUnwrap().queries)).toBe(true);
    expect(parseDataQueryManifest({ ...manifest, schemaVersion: 2 }).isErr()).toBe(true);
  });

  it.each(['constructor', '__proto__', 'then', 'default', 'get-todos', 'get\ntodos', 'getTodos\n'])(
    'rejects unsafe query identifier %s',
    (queryId) => {
      expect(
        parseDataQueryManifest({ schemaVersion: 1, queries: { [queryId]: { definition } } }).isErr()
      ).toBe(true);
    }
  );

  it('locates a rejected prototype query name while accepting the same definition under a safe name', () => {
    const error = parseDataQueryManifest({
      schemaVersion: 1,
      queries: { ['__proto__']: { definition } },
    })._unsafeUnwrapErr();
    expect(error.code).toBe('data_query.invalid_manifest');
    expect(error.message).toContain('queries');
    expect(error.message).toContain('__proto__');
    expect(
      parseDataQueryManifest({
        schemaVersion: 1,
        queries: { getTitleSafe: { definition } },
      }).isOk()
    ).toBe(true);
  });

  it('diagnoses an invalid query key without evaluating its accessor', () => {
    let getterCalled = false;
    const queries = Object.defineProperty({}, '__proto__', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return { definition };
      },
    });
    const error = parseDataQueryManifest({ schemaVersion: 1, queries })._unsafeUnwrapErr();
    expect(error.message).toContain('__proto__');
    expect(getterCalled).toBe(false);
  });

  it('retains plain-data rejection for accessors with otherwise valid query names', () => {
    let getterCalled = false;
    const queries = Object.defineProperty({}, 'getTodos', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return { definition };
      },
    });
    expect(parseDataQueryManifest({ schemaVersion: 1, queries }).isErr()).toBe(true);
    expect(getterCalled).toBe(false);
  });
  it('requires a controlled records identity for one, not a limit-one assertion', () => {
    for (const invalid of [
      definition,
      { ...definition, page: { limit: 1 } },
      {
        version: 1,
        kind: 'aggregate',
        tableId: definition.tableId,
        aggregates: [{ fieldId: `fld${'c'.repeat(16)}`, statisticFunc: 'count', alias: 'count' }],
      },
    ]) {
      expect(
        parseDataQueryManifest({
          schemaVersion: 1,
          queries: { getTodo: { definition: invalid, result: 'one' } },
        }).isErr()
      ).toBe(true);
    }
    expect(
      parseDataQueryManifest({
        schemaVersion: 1,
        queries: { getTodo: { definition: { ...definition, recordId }, result: 'one' } },
      }).isOk()
    ).toBe(true);
  });

  it('shares semantic definition validation with direct schema consumers', () => {
    const invalid = {
      schemaVersion: 1,
      queries: {
        getTodo: {
          definition: {
            ...definition,
            select: [
              { system: 'id', alias: 'id' },
              { system: 'version', alias: 'id' },
            ],
          },
        },
      },
    };
    expect(dataQueryManifestSchema.safeParse(invalid).success).toBe(false);
    expect(parseDataQueryManifest(invalid)._unsafeUnwrapErr().message).toContain(
      'queries.getTodo.definition'
    );
  });
  it('names an undeclared filter parameter instead of rejecting the filter shape', () => {
    const fieldId = `fld${'d'.repeat(16)}`;
    const filter = {
      fieldId,
      operator: 'isGreaterEqual' as const,
      value: { type: 'parameter' as const, name: 'minimum' },
    };
    const base = {
      ...definition,
      select: [{ fieldId, alias: 'amount' }],
      filter,
    };
    const missing = parseDataQueryManifest({
      schemaVersion: 1,
      queries: { getTodos: { definition: base, result: 'many' } },
    });
    const error = missing._unsafeUnwrapErr();
    expect(error.code).toBe('data_query.invalid_manifest');
    expect(error.message).toContain('queries.getTodos.definition');
    expect(error.message).toContain('minimum');
    expect(
      parseDataQueryManifest({
        schemaVersion: 1,
        queries: {
          getTodos: {
            definition: { ...base, parameters: { minimum: { type: 'number' } } },
            result: 'many',
          },
        },
      }).isOk()
    ).toBe(true);
  });

  it('binds valid literal/parameter identities and rejects invalid types, defaults and runtime IDs', () => {
    expect(
      DataQueryDefinition.create({ ...definition, recordId })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap().recordId
    ).toBe(recordId);
    const reference = { type: 'parameter', name: 'id' };
    for (const parameter of [
      { type: 'number' },
      { type: 'string', nullable: true },
      { type: 'string', default: 'bad' },
    ]) {
      expect(
        DataQueryDefinition.create({
          ...definition,
          recordId: reference,
          parameters: { id: parameter },
        }).isErr()
      ).toBe(true);
    }
    expect(DataQueryDefinition.create({ ...definition, recordId: reference }).isErr()).toBe(true);
    const query = DataQueryDefinition.create({
      ...definition,
      recordId: reference,
      parameters: { id: { type: 'string' } },
    })._unsafeUnwrap();
    expect(query.bind({ id: recordId })._unsafeUnwrap().recordId).toBe(recordId);
    expect(query.bind({ id: "bad'); select 1 --" }).isErr()).toBe(true);
  });
  it('accepts a legacy-only SQL query with ordered parameters', () => {
    const result = parseDataQueryManifest({
      schemaVersion: 1,
      queries: {
        ranked: {
          mode: 'sql-query',
          result: 'many',
          fallback: {
            sql: 'SELECT * FROM "tbl" WHERE "score" > $1',
            outputs: [{ alias: 'rank', wireType: 'numberOrString' }],
            parameters: { minimum: { type: 'number' } },
            parameterOrder: ['minimum'],
          },
        },
      },
    });
    expect(result.isOk()).toBe(true);
  });

  it.each([
    { mode: 'sql-query', fallback: undefined },
    { mode: 'auto', fallback: undefined },
    {
      mode: 'auto',
      fallback: { sql: 'SELECT 1 AS id', outputs: [{ alias: 'id', wireType: 'string' }] },
    },
    { mode: 'auto', definition },
    {
      mode: 'sql-query',
      definition,
      fallback: { sql: 'SELECT 1 AS id', outputs: [{ alias: 'id', wireType: 'string' }] },
    },
    {
      mode: 'sql-query',
      fallback: { sql: 'SELECT 1', parameterOrder: ['missing'] },
    },
    {
      mode: 'structured',
      definition: undefined,
      fallback: { sql: 'SELECT 1' },
    },
  ])('rejects malformed fallback manifest %#', (query) => {
    expect(parseDataQueryManifest({ schemaVersion: 1, queries: { query } }).isErr()).toBe(true);
  });

  it('rejects fallbacks that cannot preserve the new structured semantics', () => {
    const fallback = { sql: 'SELECT 1 AS id', outputs: [{ alias: 'id', wireType: 'string' }] };
    const cases = [
      { ...definition, page: { limit: 10, includeTotal: true } },
      {
        ...definition,
        parameters: { label: { type: 'string' } },
        filter: {
          fieldId: `fld${'b'.repeat(16)}`,
          operator: 'is',
          value: { type: 'parameter', name: 'label' },
          optional: true,
        },
      },
      {
        ...definition,
        parameters: { by: { type: 'string' } },
        sort: [
          {
            field: { type: 'parameter', name: 'by' },
            order: 'asc',
            allowed: [{ system: 'id' }],
          },
        ],
      },
      {
        ...definition,
        select: [{ fieldId: `fld${'c'.repeat(16)}`, alias: 'id', arrayDistinct: true }],
      },
    ];
    for (const structured of cases) {
      const error = parseDataQueryManifest({
        schemaVersion: 1,
        queries: {
          guarded: {
            mode: 'auto',
            definition: structured,
            fallback: { ...fallback, outputs: [{ alias: 'id', wireType: 'string' }] },
          },
        },
      })._unsafeUnwrapErr();
      expect(error.message).toContain('queries.guarded.fallback');
    }
    expect(
      parseDataQueryManifest({
        schemaVersion: 1,
        queries: { plain: { mode: 'auto', definition, fallback } },
      }).isOk()
    ).toBe(true);
  });
});

describe('array-distinct projection scope', () => {
  it('rejects arrayDistinct on aggregate groupBy instead of ignoring it', () => {
    const error = DataQueryDefinition.create({
      version: 1,
      kind: 'aggregate',
      tableId: `tbl${'a'.repeat(16)}`,
      groupBy: [{ fieldId: `fld${'b'.repeat(16)}`, alias: 'bucket', arrayDistinct: true }],
      aggregates: [{ fieldId: `fld${'c'.repeat(16)}`, statisticFunc: 'count', alias: 'count' }],
    })._unsafeUnwrapErr();
    expect(error.code).toBe('data_query.array_distinct_scope');
    expect(error.message).toContain('groupBy.0');
  });
});
