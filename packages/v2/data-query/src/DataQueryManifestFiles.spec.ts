import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { generateAppQueryArtifacts, parseDataQueryManifestText } from './DataQueryManifestFiles';

const todo = `schemaVersion: 1
queries:
  getTodos:
    definition:
      version: 1
      kind: records
      tableId: tbl${'a'.repeat(16)}
      select:
        - { system: id, alias: id }
        - { fieldId: fld${'b'.repeat(16)}, alias: title }
      parameters:
        completed: { type: boolean, default: false }
  getTodoById:
    result: one
    definition:
      version: 1
      kind: records
      tableId: tbl${'a'.repeat(16)}
      recordId: { type: parameter, name: id }
      parameters:
        id: { type: string }
      select:
        - { system: id, alias: id }
  getWireValues:
    definition:
      version: 1
      kind: records
      tableId: tbl${'a'.repeat(16)}
      select:
        - { fieldId: fld${'c'.repeat(16)}, alias: amount }
        - { fieldId: fld${'d'.repeat(16)}, alias: owners }
        - { fieldId: fld${'e'.repeat(16)}, alias: tags }
        - { system: autoNumber, alias: sequence }
`;

function artifacts(text = todo) {
  const parsed = parseDataQueryManifestText(text);
  if (parsed.isErr()) throw new Error(parsed.error.message);
  const generated = generateAppQueryArtifacts(parsed.value, {
    getTodos: {
      outputs: [
        {
          alias: 'id',
          cellValueType: 'string',
          wireType: 'string',
          isMultipleCellValue: false,
          nullable: false,
        },
        {
          alias: 'title',
          cellValueType: 'string',
          wireType: 'string',
          isMultipleCellValue: false,
          nullable: true,
        },
      ],
    },
    getTodoById: {
      outputs: [
        {
          alias: 'id',
          cellValueType: 'string',
          wireType: 'string',
          isMultipleCellValue: false,
          nullable: false,
        },
      ],
    },
    getWireValues: {
      outputs: [
        {
          alias: 'amount',
          cellValueType: 'number',
          wireType: 'numberOrString',
          isMultipleCellValue: false,
          nullable: false,
        },
        {
          alias: 'owners',
          cellValueType: 'string',
          wireType: 'unknown',
          isMultipleCellValue: true,
          nullable: true,
        },
        {
          alias: 'tags',
          cellValueType: 'string',
          wireType: 'string',
          isMultipleCellValue: true,
          nullable: true,
        },
        {
          alias: 'sequence',
          cellValueType: 'number',
          wireType: 'numberOrString',
          isMultipleCellValue: false,
          nullable: false,
        },
      ],
    },
  });
  if (generated.isErr()) throw new Error(generated.error.message);
  return generated.value;
}

interface GeneratedQueries {
  queries: {
    getTodos(parameters?: {
      completed?: boolean;
    }): Promise<Array<{ id: string; title: string | null }>>;
    getTodoById(parameters: { id: string }): Promise<{ id: string } | null>;
    getWireValues(): Promise<
      Array<{
        amount: number | string;
        owners: unknown;
        tags: string[] | null;
        sequence: number | string;
      }>
    >;
  };
}

function loadModule(
  request: (endpoint: string, options: unknown) => Promise<unknown>,
  getConfig: () => { baseId: string } = () => ({ baseId: 'bseFallback' }),
  generated = artifacts()
): GeneratedQueries {
  const compiled = ts.transpileModule(generated.module, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  const require = (name: string) => {
    if (name === 'server-only') return {};
    if (name === './request') return { request, getConfig };
    throw new Error(`Unexpected generated dependency ${name}`);
  };
  new Function('require', 'exports', compiled.outputText)(require, exports);
  return exports as GeneratedQueries;
}

describe('app query manifest files', () => {
  it('accepts Todo YAML and equivalent JSON and generates deterministically', () => {
    const parsed = parseDataQueryManifestText(todo)._unsafeUnwrap();
    expect(parseDataQueryManifestText(JSON.stringify(parsed))._unsafeUnwrap()).toEqual(parsed);
    const first = generateAppQueryArtifacts(parsed)._unsafeUnwrap();
    const reversed = {
      ...parsed,
      queries: Object.fromEntries(Object.entries(parsed.queries).reverse()),
    };
    expect(generateAppQueryArtifacts(reversed)._unsafeUnwrap()).toEqual(first);
    expect(JSON.parse(first.schema).$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    const empty = parseDataQueryManifestText('schemaVersion: 1\nqueries: {}')._unsafeUnwrap();
    expect(generateAppQueryArtifacts(empty)._unsafeUnwrap()).toEqual(
      generateAppQueryArtifacts(empty, {})._unsafeUnwrap()
    );
  });

  it.each([
    'schemaVersion: [',
    'schemaVersion: 1\nschemaVersion: 1\nqueries: {}',
    '{"schemaVersion":1,"queries":{},"queries":{}}',
    'schemaVersion: 1\nqueries: &queries {}',
    'schemaVersion: 1\nqueries: *queries',
    'schemaVersion: 1\nqueries: !custom {}',
    'schemaVersion: 1\nqueries: &queries { getTodos: *queries }',
    todo.replace('name: id', 'name: missing'),
    todo.replace('getTodoById:', '__proto__:'),
    todo.replace('  getTodoById:', '  getTodos:'),
  ])('rejects malformed or unsafe input without evaluating it', (text) => {
    expect(parseDataQueryManifestText(text).isErr()).toBe(true);
  });

  it('names an illegal __proto__ query and still accepts a safe name', () => {
    const parsed = parseDataQueryManifestText(todo.replace('getTodoById:', '__proto__:'));
    expect(parsed._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.invalid_manifest',
      message: expect.stringContaining('__proto__'),
    });
    expect(parsed._unsafeUnwrapErr().message).toContain('queries.__proto__');
    expect(parseDataQueryManifestText(todo).isOk()).toBe(true);
  });

  it('reports query path for invalid references', () => {
    const parsed = parseDataQueryManifestText(todo.replace('name: id', 'name: missing'));
    expect(parsed._unsafeUnwrapErr().message).toContain('queries.getTodoById.definition');
  });

  it('executes canonical requests through one shared request helper', async () => {
    const calls: unknown[] = [];
    const generated = loadModule(async (endpoint, options) => {
      calls.push({ endpoint, options });
      return { ok: true, data: { rows: [{ id: `rec${'c'.repeat(16)}`, title: 'Todo' }] } };
    });
    expect(await generated.queries.getTodos({ completed: true })).toEqual([
      { id: `rec${'c'.repeat(16)}`, title: 'Todo' },
    ]);
    expect(calls).toEqual([
      {
        endpoint: '/v2/queries/execute',
        options: {
          method: 'POST',
          acceptErrorResponse: true,
          body: {
            queryId: 'getTodos',
            definition:
              parseDataQueryManifestText(todo)._unsafeUnwrap().queries.getTodos.definition,
            parameters: { completed: true },
          },
        },
      },
    ]);
  });

  it('routes legacy-only queries and unsupported structured queries through the SQL fallback', async () => {
    const parsed = parseDataQueryManifestText(
      JSON.stringify({
        schemaVersion: 1,
        queries: {
          legacyReport: {
            mode: 'sql-query',
            fallback: {
              sql: 'SELECT rank FROM report WHERE score > $1',
              outputs: [{ alias: 'rank', wireType: 'numberOrString' }],
              parameters: { minimum: { type: 'number' } },
              parameterOrder: ['minimum'],
            },
          },
          autoReport: {
            mode: 'auto',
            definition: {
              version: 1,
              kind: 'records',
              tableId: `tbl${'b'.repeat(16)}`,
              select: [{ system: 'id', alias: 'rank' }],
            },
            fallback: {
              sql: 'SELECT rank FROM report',
              outputs: [{ alias: 'rank', wireType: 'numberOrString' }],
            },
          },
          fallbackReport: {
            definition: {
              version: 1,
              kind: 'records',
              tableId: `tbl${'a'.repeat(16)}`,
              select: [{ system: 'id', alias: 'rank' }],
            },
            fallback: { sql: 'SELECT rank FROM report' },
          },
        },
      })
    )._unsafeUnwrap();
    const generated = generateAppQueryArtifacts(parsed)._unsafeUnwrap();
    const calls: Array<{ endpoint: string; options: any }> = [];
    const request = async (endpoint: string, options: any) => {
      calls.push({ endpoint, options });
      if (endpoint === '/v2/queries/execute') {
        return {
          ok: false,
          error: {
            code: 'data_query.unsupported_join',
            message: 'unsupported',
            tags: ['validation'],
          },
        };
      }
      return { rows: [{ rank: 1 }] };
    };
    const loaded = loadModule(request, () => ({ baseId: 'bseFallback' }), generated) as unknown as {
      queries: {
        legacyReport(parameters: { minimum: number }): Promise<Array<Record<string, unknown>>>;
        autoReport(): Promise<Array<Record<string, unknown>>>;
        fallbackReport(): Promise<Array<Record<string, unknown>>>;
      };
    };

    await expect(loaded.queries.legacyReport({ minimum: 3 })).resolves.toEqual([{ rank: 1 }]);
    await expect(loaded.queries.autoReport()).resolves.toEqual([{ rank: 1 }]);
    await expect(loaded.queries.fallbackReport()).resolves.toEqual([{ rank: 1 }]);
    expect(calls).toHaveLength(5);
    expect(calls[0]).toMatchObject({
      endpoint: '/base/bseFallback/sql-query',
      options: {
        body: { sql: 'SELECT rank FROM report WHERE score > $1', parameters: [3] },
        headers: {
          'x-teable-query-planned-mode': 'sql-query',
          'x-teable-query-selected-mode': 'sql-query',
          'x-teable-query-fallback': 'false',
          'x-teable-query-fallback-reason': 'sql_query_by_design',
        },
      },
    });
    expect(calls[1]).toMatchObject({ endpoint: '/v2/queries/execute' });
    expect(calls[2]).toMatchObject({
      endpoint: '/base/bseFallback/sql-query',
      options: {
        headers: {
          'x-teable-query-planned-mode': 'structured',
          'x-teable-query-selected-mode': 'sql-query',
          'x-teable-query-fallback': 'true',
          'x-teable-query-fallback-reason': 'data_query.unsupported_join',
        },
      },
    });
    expect(calls[3]).toMatchObject({ endpoint: '/v2/queries/execute' });
    expect(calls[4]).toMatchObject({
      endpoint: '/base/bseFallback/sql-query',
      options: {
        headers: {
          'x-teable-query-planned-mode': 'structured',
          'x-teable-query-selected-mode': 'sql-query',
          'x-teable-query-fallback': 'true',
          'x-teable-query-fallback-reason': 'data_query.unsupported_join',
        },
      },
    });
  });

  it('rejects invalid SQL parameters before a request and applies defaults only to absent values', async () => {
    const manifest = parseDataQueryManifestText(
      JSON.stringify({
        schemaVersion: 1,
        queries: {
          report: {
            mode: 'sql-query',
            fallback: {
              sql: 'SELECT rank FROM report LIMIT $1 OFFSET $2',
              outputs: [{ alias: 'rank', wireType: 'numberOrString' }],
              parameters: {
                limit: { type: 'number' },
                offset: { type: 'number', default: 0 },
                label: { type: 'string', nullable: true, default: null },
              },
              parameterOrder: ['limit', 'offset', 'label'],
            },
          },
        },
      })
    )._unsafeUnwrap();
    const calls: unknown[] = [];
    const loaded = loadModule(
      async (_endpoint, options) => {
        calls.push(options);
        return { rows: [{ rank: 1 }] };
      },
      () => ({ baseId: 'bseFallback' }),
      generateAppQueryArtifacts(manifest)._unsafeUnwrap()
    ) as unknown as { queries: { report(parameters: unknown): Promise<unknown> } };
    for (const [parameters, code] of [
      [{}, 'missing_parameter'],
      [{ limit: '2' }, 'parameter_type'],
      [{ limit: null }, 'parameter_type'],
      [{ limit: undefined }, 'parameter_type'],
      [{ limit: NaN }, 'parameter_type'],
      [{ limit: Infinity }, 'parameter_type'],
      [{ limit: 1, offset: undefined }, 'parameter_type'],
      [{ limit: 1, extra: true }, 'unknown_parameter'],
      [null, 'parameter_map'],
      [[], 'parameter_map'],
      [Object.create({ limit: 1 }), 'parameter_map'],
    ]) {
      await expect(loaded.queries.report(parameters)).rejects.toMatchObject({
        code: `data_query.${code}`,
        queryId: 'report',
      });
    }
    let getterCalled = false;
    const accessor = Object.defineProperty({}, 'limit', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return 1;
      },
    });
    await expect(loaded.queries.report(accessor)).rejects.toMatchObject({
      code: 'data_query.parameter_map',
    });
    expect(getterCalled).toBe(false);
    expect(calls).toEqual([]);
    await expect(loaded.queries.report({ limit: 1 })).resolves.toEqual([{ rank: 1 }]);
    expect(calls).toMatchObject([{ body: { parameters: [1, 0, null] } }]);
  });

  it('validates array elements and date semantics before SQL execution', async () => {
    const cases = [
      { type: 'string', valid: '', invalid: [1, false] },
      { type: 'boolean', valid: false, invalid: [0, 'false'] },
      { type: 'string[]', valid: ['a', ''], invalid: [[], ['a', 2], 'a'] },
      { type: 'number[]', valid: [0, 2], invalid: [[], [1, '2'], [Infinity], Array(1)] },
      { type: 'boolean[]', valid: [false, true], invalid: [[], [false, 1]] },
      {
        type: 'date',
        valid: { mode: 'exactDate', timeZone: 'UTC', exactDate: '2026-01-01T00:00:00Z' },
        invalid: [
          { mode: 'exactDate', timeZone: 'UTC' },
          { mode: 'today', timeZone: 'unknown' },
          { mode: 'today', timeZone: 'UTC', extra: true },
          { mode: 'daysAgo', timeZone: 'UTC' },
          { mode: 'daysAgo', timeZone: 'UTC', numberOfDays: '2' },
          { mode: 'exactDate', timeZone: 'UTC', exactDate: '2026-02-30T00:00:00Z' },
          { mode: 'daysAgo', timeZone: 'UTC', numberOfDays: Number.MAX_SAFE_INTEGER + 1 },
          {
            mode: 'dateRange',
            timeZone: 'UTC',
            exactDate: '2026-02-01T00:00:00Z',
            exactDateEnd: '2026-01-01T00:00:00Z',
          },
        ],
      },
    ];
    for (const parameter of cases) {
      const manifest = parseDataQueryManifestText(
        JSON.stringify({
          schemaVersion: 1,
          queries: {
            report: {
              mode: 'sql-query',
              fallback: {
                sql: 'SELECT $1 AS value',
                outputs: [{ alias: 'value' }],
                parameters: { value: { type: parameter.type } },
                parameterOrder: ['value'],
              },
            },
          },
        })
      )._unsafeUnwrap();
      let requested = false;
      const loaded = loadModule(
        async () => {
          requested = true;
          return { rows: [{ value: parameter.valid }] };
        },
        () => ({ baseId: 'bseFallback' }),
        generateAppQueryArtifacts(manifest)._unsafeUnwrap()
      ) as unknown as { queries: { report(parameters: unknown): Promise<unknown> } };
      for (const value of parameter.invalid) {
        await expect(loaded.queries.report({ value })).rejects.toMatchObject({
          code: 'data_query.parameter_type',
        });
      }
      expect(requested).toBe(false);
      await expect(loaded.queries.report({ value: parameter.valid })).resolves.toEqual([
        { value: parameter.valid },
      ]);
    }
  });

  it.each([false, true])(
    'enforces declared SQL-query outputs with nullable=%s',
    async (nullable) => {
      const parsed = parseDataQueryManifestText(
        JSON.stringify({
          schemaVersion: 1,
          queries: {
            report: {
              mode: 'sql-query',
              fallback: {
                sql: 'SELECT rank, private_email FROM report',
                outputs: [{ alias: 'rank', wireType: 'numberOrString', nullable }],
              },
            },
          },
        })
      )._unsafeUnwrap();
      const generated = generateAppQueryArtifacts(parsed)._unsafeUnwrap();
      const load = (rows: unknown[]) =>
        loadModule(
          async () => ({ rows }),
          () => ({ baseId: 'bseFallback' }),
          generated
        ) as unknown as {
          queries: { report(): Promise<Array<Record<string, unknown>>> };
        };

      await expect(
        load([{ rank: '9007199254740993', private_email: 'secret@example.com' }]).queries.report()
      ).resolves.toEqual([{ rank: '9007199254740993' }]);
      if (nullable) {
        await expect(load([{ rank: null }]).queries.report()).resolves.toEqual([{ rank: null }]);
      }
      for (const row of [{}, { rank: true }, ...(nullable ? [] : [{ rank: null }])]) {
        await expect(load([row]).queries.report()).rejects.toMatchObject({
          code: 'data_query.sql_query_output_mismatch',
        });
      }
    }
  );

  it('handles zero, one and multiple rows without silently selecting an arbitrary row', async () => {
    const row = { id: `rec${'c'.repeat(16)}` };
    for (const rows of [[], [row]]) {
      const generated = loadModule(async () => ({ ok: true, data: { rows } }));
      expect(await generated.queries.getTodoById({ id: row.id })).toEqual(rows[0] ?? null);
    }
    const generated = loadModule(async () => ({ ok: true, data: { rows: [row, row] } }));
    await expect(generated.queries.getTodoById({ id: row.id })).rejects.toMatchObject({
      code: 'data_query.cardinality',
      queryId: 'getTodoById',
    });
  });

  it('preserves canonical error codes and rejects malformed envelopes without exposing server diagnostics', async () => {
    const generated = loadModule(async () => ({
      ok: false,
      error: { code: 'data_query.forbidden', message: 'private-data', tags: ['forbidden'] },
    }));
    await expect(generated.queries.getTodos()).rejects.toMatchObject({
      code: 'data_query.forbidden',
      message: 'Query getTodos failed (data_query.forbidden)',
    });
    const malformed = loadModule(async () => ({ ok: true, data: { rows: [null] } }));
    await expect(malformed.queries.getTodos()).rejects.toMatchObject({
      code: 'data_query.invalid_response',
    });
    const unreachable = loadModule(async () => {
      throw new Error('private-data');
    });
    await expect(unreachable.queries.getTodos()).rejects.toMatchObject({
      code: 'data_query.transport_failed',
    });
  });

  it('preserves composite JSON values and unsafe numeric strings from the canonical response', async () => {
    const row = {
      amount: '9007199254740993',
      owners: [{ id: 'usrSynthetic', title: 'Synthetic user' }],
      tags: ['pending'],
      sequence: '9007199254740995',
    };
    const generated = loadModule(async () => ({ ok: true, data: { rows: [row] } }));
    expect(await generated.queries.getWireValues()).toEqual([row]);
  });

  it('emits callable parameter and live output types checked by TypeScript', () => {
    const files: Record<string, string> = {
      '/query-types/queries.ts': artifacts().module,
      '/query-types/request.ts':
        'export declare function request<T>(path:string, options:unknown):Promise<T>; export declare function getConfig(): {baseId:string};',
      '/query-types/server-only.d.ts': "declare module 'server-only';",
      '/query-types/consumer.ts': `import {queries, QueryRows} from './queries';
queries.getTodos();
queries.getTodos({completed: true});
queries.getTodoById({id: 'record'});
// @ts-expect-error required ID
queries.getTodoById();
// @ts-expect-error boolean input, not string
queries.getTodos({completed: 'false'});
// @ts-expect-error unknown name
queries.missing();
const row: QueryRows['getTodos'] = {id: 'record', title: null};
// @ts-expect-error live title is string or null, never numeric
const wrong: QueryRows['getTodos'] = {id: 'record', title: 1};
const wire: QueryRows['getWireValues'] = {amount: '9007199254740993', owners: [{id: 'user'}], tags: null, sequence: 1};
const alternate: QueryRows['getWireValues'] = {amount: 42, owners: {id: 'user'}, tags: ['pending'], sequence: '9007199254740995'};
// @ts-expect-error numeric wire output is not guaranteed to be a number
const numericOnly: number = wire.amount;
// @ts-expect-error composite field requires narrowing, never assume semantic string type
const ownerText: string = wire.owners;
// @ts-expect-error unknown describes the whole JSON value, not an asserted array
const ownerList: unknown[] = wire.owners;
// @ts-expect-error known multi-select has string values, not numeric values
const wrongTags: QueryRows['getWireValues'] = {...wire, tags: [1]};
void alternate; void numericOnly; void ownerText; void ownerList; void wrongTags;
void row; void wrong;`,
    };
    const options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: [],
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    };
    const host = ts.createCompilerHost(options);
    const originalRead = host.readFile;
    const originalExists = host.fileExists;
    const originalDirectoryExists = host.directoryExists;
    host.readFile = (path) => files[path] ?? originalRead(path);
    host.fileExists = (path) => path in files || originalExists(path);
    host.directoryExists = (path) =>
      path === '/query-types' || Boolean(originalDirectoryExists?.(path));
    host.getSourceFile = (path, languageVersion) => {
      const source = host.readFile(path);
      return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion);
    };
    const program = ts.createProgram(Object.keys(files), options, host);
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    ).toEqual([]);
  });
});
