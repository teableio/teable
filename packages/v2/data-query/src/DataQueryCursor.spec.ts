import { createHash, createHmac } from 'node:crypto';
import { ActorId, DefaultTableMapper, FieldOptionsDtoVisitor } from '@teable/v2-core';
import { ok } from 'neverthrow';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type { BoundDataQueryPlan } from './BoundDataQueryPlan';
import { dataQueryCapabilities } from './DataQueryCapabilities';
import {
  createDataQueryCursorBinding,
  decodeDataQueryCursor,
  encodeDataQueryCursor,
} from './DataQueryCursor';
import { DataQueryDefinition, dataQueryOptionalParameters } from './DataQueryDefinition';
import { parseDataQueryManifest } from './DataQueryManifest';
import { generateAppQueryArtifacts } from './DataQueryManifestFiles';
import { queryExecutionResultSchema } from './queryExecutionProtocol';

const tableId = `tbl${'a'.repeat(16)}`;
const fieldId = `fld${'b'.repeat(16)}`;
const reference = { type: 'parameter' as const, name: 'after' };
const records = {
  version: 7,
  kind: 'records',
  tableId,
  parameters: { after: { type: 'string' } },
  select: [{ fieldId, alias: 'title' }],
  sort: [{ fieldId, order: 'asc', nulls: 'last' }],
  page: { limit: 2, after: reference },
};
const source = {
  alias: 'root',
  tableId,
  physical: { schema: 'public', tableName: 'records' },
  cardinality: 'one' as const,
  fields: [
    {
      fieldId,
      column: 'title',
      fieldType: 'singleLineText',
      cellValueType: 'string',
      isMultipleCellValue: false,
      isComputed: false,
      isLookupOrConditional: false,
    },
  ],
};
const plan: BoundDataQueryPlan = {
  definitionVersion: 7,
  resultGrain: 'record',
  kind: 'records',
  tableId,
  root: source,
  sources: [],
  projections: [{ kind: 'field', source: 'root', fieldId, column: 'title', alias: 'title' }],
  aggregates: [],
  groupBy: [],
  sort: [{ kind: 'target', source: 'root', fieldId, column: 'title', order: 'asc', nulls: 'last' }],
  page: { limit: 2, after: { parameter: 'after' }, includeTotal: false },
  parameters: [{ name: 'after', type: 'string', nullable: false, hasDefault: false }],
  relationFilters: [],
  usage: [{ source: 'root', fieldId, usages: ['projection', 'sort'] }],
};
const context = { actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap() };
const position = { values: [null, '"same"', '9007199254740993'], id: `rec${'a'.repeat(16)}` };
const signingKey = 'test-only-cursor-signing-key';

describe('V7 canonical cursor pagination', () => {
  it('admits a runtime-only optional cursor parameter without changing old grammars', () => {
    const definition = DataQueryDefinition.create(records)._unsafeUnwrap();
    expect(dataQueryOptionalParameters(definition.snapshot()).has('after')).toBe(true);
    expect(definition.bind({})._unsafeUnwrap()).toMatchObject({ limit: 2, offset: 0, cursor: {} });
    expect(definition.bind({ after: 'opaque-token' })._unsafeUnwrap().cursor).toEqual({
      after: 'opaque-token',
    });
    expect(dataQueryCapabilities.definitionVersions).toContain(7);
    for (const after of ['', null, 10]) expect(definition.bind({ after }).isErr()).toBe(true);
    for (const page of [
      { limit: 2, offset: 0 },
      { limit: 2, after: 'literal-token' },
      { limit: 2, after: null },
    ])
      expect(DataQueryDefinition.create({ ...records, page }).isErr()).toBe(true);
    for (const version of [1, 2, 3, 4, 5, 6, 8]) {
      expect(DataQueryDefinition.create({ ...records, version }).isErr()).toBe(true);
      const old = DataQueryDefinition.create({
        ...records,
        version,
        page: { limit: 2, offset: 9 },
      })._unsafeUnwrap();
      expect(old.bind({ after: 'unused' })._unsafeUnwrap()).toMatchObject({
        limit: 2,
        offset: 9,
        cursor: undefined,
      });
    }
    expect(
      DataQueryDefinition.create({
        version: 7,
        kind: 'aggregate',
        tableId,
        aggregates: [{ fieldId, statisticFunc: 'count', alias: 'count' }],
      }).isErr()
    ).toBe(true);
  });

  it('requires a dedicated declared string continuation parameter with no default', () => {
    for (const parameter of [
      { type: 'number' },
      { type: 'string', nullable: true },
      { type: 'string', default: 'token' },
    ])
      expect(
        DataQueryDefinition.create({ ...records, parameters: { after: parameter } }).isErr()
      ).toBe(true);
    expect(DataQueryDefinition.create({ ...records, parameters: {} }).isErr()).toBe(true);
    expect(
      DataQueryDefinition.create({
        ...records,
        filter: { fieldId, operator: 'is', value: reference },
      }).isErr()
    ).toBe(true);
    for (const page of [undefined, { limit: 2 }, { limit: 2, includeTotal: true }]) {
      expect(DataQueryDefinition.create({ ...records, page })._unsafeUnwrapErr().code).toBe(
        'data_query.invalid_definition'
      );
    }
    const renamed = DataQueryDefinition.create({
      ...records,
      parameters: { cursor: { type: 'string' } },
      page: { limit: 2, after: { type: 'parameter', name: 'cursor' } },
    })._unsafeUnwrap();
    expect(renamed.bind({})._unsafeUnwrap().cursor).toEqual({});
    expect(renamed.bind({ cursor: 'opaque-token' })._unsafeUnwrap().cursor).toEqual({
      after: 'opaque-token',
    });
  });

  it('retains DISTINCT sort validation and relation-existence version semantics', () => {
    const target = `tbl${'c'.repeat(16)}`;
    expect(
      DataQueryDefinition.create({ ...records, distinct: true })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap().sort
    ).toEqual([{ alias: 'title', order: 'asc', nulls: 'last' }]);
    expect(
      DataQueryDefinition.create({
        ...records,
        distinct: true,
        sort: [{ system: 'createdTime', order: 'asc' }],
      }).isErr()
    ).toBe(true);
    for (const quantifier of ['any', 'none']) {
      expect(
        DataQueryDefinition.create({
          ...records,
          relations: { children: { linkFieldId: fieldId, tableId: target } },
          filter: { relation: 'children', quantifier },
        }).isOk()
      ).toBe(true);
      expect(
        DataQueryDefinition.create({
          ...records,
          filter: { relation: 'missing', quantifier },
        }).isErr()
      ).toBe(true);
    }
  });

  it('binds portable cursors to effective parameters, definition, sort, schema and authorization scope', () => {
    const definition = DataQueryDefinition.create(records)._unsafeUnwrap();
    const query = definition.bind({})._unsafeUnwrap();
    const input = {
      context,
      plan,
      query,
      scopes: new Map([['root', { readableFieldIds: new Set([fieldId]) }]]),
      schemaSignature: 'schema-a',
    };
    const binding = createDataQueryCursorBinding(input)._unsafeUnwrap();
    const token = encodeDataQueryCursor(binding, position, signingKey)._unsafeUnwrap();
    expect(decodeDataQueryCursor(token, binding, signingKey)._unsafeUnwrap()).toEqual(position);
    expect(decodeDataQueryCursor(undefined, binding, signingKey)._unsafeUnwrap()).toBeUndefined();
    expect(
      createDataQueryCursorBinding({
        ...input,
        query: definition.bind({ after: token })._unsafeUnwrap(),
      })._unsafeUnwrap()
    ).toBe(binding);
    for (const changed of [
      { ...input, schemaSignature: 'schema-b' },
      { ...input, scopes: new Map([['root', { readableFieldIds: new Set<string>() }]]) },
      { ...input, plan: { ...plan, sort: [] } },
      {
        ...input,
        query: DataQueryDefinition.create({ ...records, page: { limit: 3, after: reference } })
          ._unsafeUnwrap()
          .bind({})
          ._unsafeUnwrap(),
      },
      { ...input, context: { actorId: ActorId.create(`usr${'b'.repeat(16)}`)._unsafeUnwrap() } },
    ]) {
      const other = createDataQueryCursorBinding(changed)._unsafeUnwrap();
      expect(other).not.toBe(binding);
      expect(decodeDataQueryCursor(token, other, signingKey)._unsafeUnwrapErr().code).toBe(
        'data_query.invalid_cursor'
      );
    }
    const parameterized = DataQueryDefinition.create({
      ...records,
      parameters: { after: { type: 'string' }, label: { type: 'string' } },
      filter: { fieldId, operator: 'is', value: { type: 'parameter', name: 'label' } },
    })._unsafeUnwrap();
    const first = createDataQueryCursorBinding({
      ...input,
      query: parameterized.bind({ label: 'a' })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const second = createDataQueryCursorBinding({
      ...input,
      query: parameterized.bind({ label: 'b' })._unsafeUnwrap(),
    })._unsafeUnwrap();
    expect(first).not.toBe(second);
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'invalidates legacy ordinary positions while preserving DISTINCT (distinct=%s, sorted=%s)',
    (distinct, sorted) => {
      const definition = DataQueryDefinition.create({
        ...records,
        ...(distinct ? { distinct: true } : {}),
        ...(sorted ? {} : { sort: undefined }),
      })._unsafeUnwrap();
      const query = definition.bind({})._unsafeUnwrap();
      const cursorPlan: BoundDataQueryPlan = {
        ...plan,
        resultGrain: distinct ? 'distinctTuple' : 'record',
        sort: sorted ? plan.sort : [],
      };
      // Reproduce the version-1 binding emitted before ordinary records adopted native V6 keys.
      const legacy = {
        version: 1,
        definition: definition.snapshot(),
        plan: cursorPlan,
        parameters: {},
        sort: query.sort,
        recordId: null,
        schema: null,
        actorId: context.actorId.toString(),
        scopes: {},
        schemaSignature: null,
      };
      const canonicalJson = JSON.stringify(legacy, (_key, value) =>
        value === undefined
          ? null
          : value !== null && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
            : value
      );
      const legacyBinding = createHash('sha256').update(canonicalJson).digest('hex');
      const token = encodeDataQueryCursor(legacyBinding, position, signingKey)._unsafeUnwrap();
      const binding = createDataQueryCursorBinding({
        context,
        plan: cursorPlan,
        query,
        scopes: {},
      })._unsafeUnwrap();
      const result = decodeDataQueryCursor(token, binding, signingKey);
      if (distinct) {
        expect(binding).toBe(legacyBinding);
        expect(result._unsafeUnwrap()).toEqual(position);
      } else {
        expect(binding).not.toBe(legacyBinding);
        expect(result._unsafeUnwrapErr().code).toBe('data_query.invalid_cursor');
      }
    }
  );

  it('binds prototype-named authorization properties without depending on insertion order', () => {
    const input = {
      context,
      plan,
      query: DataQueryDefinition.create(records)._unsafeUnwrap().bind({})._unsafeUnwrap(),
      scopes: JSON.parse('{"__proto__":{"role":"reader"},"constructor":"kept","z":1}'),
    };
    const binding = createDataQueryCursorBinding(input)._unsafeUnwrap();
    const token = encodeDataQueryCursor(binding, position, signingKey)._unsafeUnwrap();
    const reordered = createDataQueryCursorBinding({
      ...input,
      scopes: JSON.parse('{"z":1,"constructor":"kept","__proto__":{"role":"reader"}}'),
    })._unsafeUnwrap();
    expect(decodeDataQueryCursor(token, reordered, signingKey)._unsafeUnwrap()).toEqual(position);
    for (const scopes of [
      JSON.parse('{"__proto__":{"role":"writer"},"constructor":"kept","z":1}'),
      JSON.parse('{"__proto__":{"role":"reader"},"constructor":"changed","z":1}'),
    ]) {
      const changed = createDataQueryCursorBinding({ ...input, scopes })._unsafeUnwrap();
      expect(decodeDataQueryCursor(token, changed, signingKey)._unsafeUnwrapErr().code).toBe(
        'data_query.invalid_cursor'
      );
    }
  });

  it('preserves schema-bound continuations across physical and JSON DTO normalization', () => {
    const table = new DefaultTableMapper()
      .toDomain({
        id: tableId,
        baseId: `bse${'a'.repeat(16)}`,
        name: 'Cursor schema',
        dbTableName: 'public.records',
        primaryFieldId: fieldId,
        fields: [{ id: fieldId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' }],
        views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      })
      ._unsafeUnwrap();
    const input = {
      context,
      plan,
      tables: new Map([['root', table]]),
      query: DataQueryDefinition.create(records)._unsafeUnwrap().bind({})._unsafeUnwrap(),
      scopes: {},
    };
    const options = vi.spyOn(FieldOptionsDtoVisitor.prototype, 'visitSingleLineTextField');
    const binding = (value: unknown) => {
      options.mockReturnValue(ok(value));
      return createDataQueryCursorBinding(input);
    };
    try {
      const first = binding(
        JSON.parse(
          '{"nested":{"__proto__":{"role":"reader"},"constructor":"kept","values":[true,null,1]}}'
        )
      )._unsafeUnwrap();
      const token = encodeDataQueryCursor(first, position, signingKey)._unsafeUnwrap();
      const moved = binding({
        dbFieldName: 'moved_title',
        missing: undefined,
        nested: JSON.parse(
          '{"dbTableName":"moved.records","values":[true,null,1],"constructor":"kept","__proto__":{"role":"reader"}}'
        ),
      })._unsafeUnwrap();
      expect(decodeDataQueryCursor(token, moved, signingKey)._unsafeUnwrap()).toEqual(position);
      const changed = binding(
        JSON.parse(
          '{"nested":{"__proto__":{"role":"writer"},"constructor":"kept","values":[true,null,1]}}'
        )
      )._unsafeUnwrap();
      expect(decodeDataQueryCursor(token, changed, signingKey)._unsafeUnwrapErr().code).toBe(
        'data_query.invalid_cursor'
      );

      const normalized = binding({
        exact: { bigint: '9007199254740993' },
        values: [null],
      })._unsafeUnwrap();
      expect(
        binding({
          exact: 9007199254740993n,
          values: [undefined],
          toJSON: () => 'must not replace schema state',
        })._unsafeUnwrap()
      ).toBe(normalized);
      for (const value of [NaN, Infinity, Symbol('private'), () => 'private']) {
        expect(binding({ values: [value] })._unsafeUnwrapErr().code).toBe(
          'data_query.invalid_cursor'
        );
      }
      class SchemaArray extends Array<unknown> {}
      expect(binding({ values: SchemaArray.of(null) })._unsafeUnwrap()).toBe(
        binding({ values: [null] })._unsafeUnwrap()
      );
      expect(binding({ values: Array(1) })._unsafeUnwrap()).toBe(
        binding({ values: [null] })._unsafeUnwrap()
      );
      const proxyValues = (values: unknown[]) =>
        new Proxy([], {
          get(target, key, receiver) {
            if (key === 'map') return () => values;
            return Reflect.get(target, key, receiver);
          },
        });
      expect(binding({ values: proxyValues([NaN]) })._unsafeUnwrapErr().code).toBe(
        'data_query.invalid_cursor'
      );
      expect(binding({ values: proxyValues([9007199254740993n]) })._unsafeUnwrap()).toBe(
        binding({ values: [{ bigint: '9007199254740993' }] })._unsafeUnwrap()
      );
    } finally {
      options.mockRestore();
    }
  });

  it('rejects malformed, truncated and corrupt tokens without echoing private input', () => {
    const token = encodeDataQueryCursor('binding', position, signingKey)._unsafeUnwrap();
    for (const value of [
      '',
      'not valid',
      'e30',
      `${token}=`,
      token.slice(0, -1),
      `${token.slice(0, -5)}AAAAA`,
      'x'.repeat(1_048_577),
    ]) {
      const error = decodeDataQueryCursor(value, 'binding', signingKey)._unsafeUnwrapErr();
      expect(error.code).toBe('data_query.invalid_cursor');
      expect(error.message).not.toContain(value || 'private-input');
    }
    const legacy = { values: ['"legacy"'], id: 'rec1' };
    expect(
      decodeDataQueryCursor(
        encodeDataQueryCursor('binding', legacy, signingKey)._unsafeUnwrap(),
        'binding',
        signingKey
      )._unsafeUnwrap()
    ).toEqual(legacy);
  });

  it('rejects re-checksummed forgeries, legacy checksums and signatures from another key before parsing', () => {
    const token = encodeDataQueryCursor('binding', position, signingKey)._unsafeUnwrap();
    const [, payloadText, originalSignature] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadText!, 'base64url').toString('utf8'));
    const forged = { ...payload, position: { ...position, values: ['40'] } };
    const checksum = createHash('sha256').update(JSON.stringify(forged)).digest('hex');
    const forgedText = Buffer.from(JSON.stringify({ ...forged, checksum })).toString('base64url');
    const legacyPayload = { version: 1, binding: payload.binding, position };
    const legacy = Buffer.from(
      JSON.stringify({
        ...legacyPayload,
        checksum: createHash('sha256').update(JSON.stringify(legacyPayload)).digest('hex'),
      })
    ).toString('base64url');
    const parse = vi.spyOn(JSON, 'parse');
    try {
      for (const forgedToken of [
        `v2.${forgedText}.${originalSignature}`,
        legacy,
        `v2.${payloadText}=.${originalSignature}`,
        `${token}=`,
        encodeDataQueryCursor('binding', position, 'attacker-key')._unsafeUnwrap(),
      ]) {
        const error = decodeDataQueryCursor(forgedToken, 'binding', signingKey)._unsafeUnwrapErr();
        expect(error.code).toBe('data_query.invalid_cursor');
        expect(error.message).not.toContain(signingKey);
      }
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    expect(decodeDataQueryCursor(token, 'binding', 'another-replica-key').isErr()).toBe(true);
    expect(decodeDataQueryCursor(token, 'binding', '').isErr()).toBe(true);
    expect(encodeDataQueryCursor('binding', position, '').isErr()).toBe(true);
  });

  it('bounds authenticated envelopes and rejects invalid position types without parsing sort text', () => {
    const token = encodeDataQueryCursor('binding', position, signingKey)._unsafeUnwrap();
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
    const sign = (value: unknown) => {
      const wire = `v2.${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
      return `${wire}.${createHmac('sha256', signingKey).update(wire).digest('base64url')}`;
    };
    for (const invalidEnvelope of [
      { ...payload, version: 1 },
      { ...payload, binding: {} },
      { ...payload, position: null },
      { ...payload, position: [] },
      { ...payload, extra: true },
      [],
      null,
    ]) {
      expect(
        decodeDataQueryCursor(sign(invalidEnvelope), 'binding', signingKey)._unsafeUnwrapErr().code
      ).toBe('data_query.invalid_cursor');
    }
    const nativeScalars = { values: [false, 'false', true, 'true', null], id: 'record' };
    const encoded = encodeDataQueryCursor('binding', nativeScalars, signingKey)._unsafeUnwrap();
    expect(decodeDataQueryCursor(encoded, 'binding', signingKey)._unsafeUnwrap()).toEqual(
      nativeScalars
    );
    for (const invalidPosition of [
      { values: [40], id: 'record' },
      { values: [{}], id: 'record' },
      { values: [[1, 2]], id: 'record' },
      { values: [], id: '' },
      { values: [], id: 'x'.repeat(257) },
      { values: Array(10_001).fill(null), id: 'record' },
      { values: [], id: 'record', extra: true },
    ]) {
      expect(
        decodeDataQueryCursor(
          sign({ ...payload, position: invalidPosition }),
          'binding',
          signingKey
        )._unsafeUnwrapErr().code
      ).toBe('data_query.invalid_cursor');
      expect(encodeDataQueryCursor('binding', invalidPosition, signingKey).isErr()).toBe(true);
    }
    const oversized = { values: ['x'.repeat(8 * 1024 * 1024)], id: 'record' };
    expect(encodeDataQueryCursor('binding', oversized, signingKey).isErr()).toBe(true);
    const oversizedToken = sign({ ...payload, position: oversized });
    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(decodeDataQueryCursor(oversizedToken, 'binding', signingKey).isErr()).toBe(true);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    const native = {
      values: [
        JSON.stringify('x'.repeat(5000)),
        '{9007199254740993,2,NULL,-0.0000000000000000001}',
        '{"nested":[true,null,{"n":9007199254740993}]}',
        null,
      ],
      id: 'record-native',
    };
    expect(
      decodeDataQueryCursor(
        encodeDataQueryCursor('binding', native, signingKey)._unsafeUnwrap(),
        'binding',
        signingKey
      )._unsafeUnwrap()
    ).toEqual(native);
    const wide = { values: Array(10_000).fill(null), id: 'record-wide' };
    expect(
      decodeDataQueryCursor(
        encodeDataQueryCursor('binding', wide, signingKey)._unsafeUnwrap(),
        'binding',
        signingKey
      )._unsafeUnwrap()
    ).toEqual(wide);
  });

  it('continues long scalar sort values through binding and the wire envelope', () => {
    const longPosition = { values: [JSON.stringify('sort-key'.repeat(131072))], id: 'record-long' };
    const token = encodeDataQueryCursor('binding', longPosition, signingKey)._unsafeUnwrap();
    expect(decodeDataQueryCursor(token, 'binding', signingKey)._unsafeUnwrap()).toEqual(
      longPosition
    );
    expect(
      DataQueryDefinition.create(records)._unsafeUnwrap().bind({ after: token })._unsafeUnwrap()
        .cursor?.after
    ).toBe(token);
    expect(
      queryExecutionResultSchema.parse({ rows: [], page: { limit: 2, nextCursor: token } }).page
    ).toEqual({ limit: 2, nextCursor: token });
  });

  it('accepts terminal/no-total envelopes and keeps offset pages strict', () => {
    for (const page of [
      { limit: 2, nextCursor: null },
      { limit: 2, nextCursor: 'opaque', total: 7 },
      { limit: 2, offset: 9, total: 11 },
    ])
      expect(queryExecutionResultSchema.safeParse({ rows: [], page }).success).toBe(true);
    for (const page of [
      { limit: 2 },
      { limit: 2, offset: 0 },
      { limit: 2, nextCursor: '' },
      { limit: 2, nextCursor: null, offset: 0 },
      { limit: 2, nextCursor: null, total: -1 },
    ])
      expect(queryExecutionResultSchema.safeParse({ rows: [], page }).success).toBe(false);
  });

  it('generates page return types for cursor queries without requiring totals or after', () => {
    const manifest = {
      schemaVersion: 1 as const,
      queries: {
        browse: { definition: records },
        totals: { definition: { ...records, page: { ...records.page, includeTotal: true } } },
        offset: { definition: { ...records, version: 6, page: { limit: 2, includeTotal: true } } },
      },
    };
    const generated = generateAppQueryArtifacts(
      parseDataQueryManifest(manifest)._unsafeUnwrap()
    )._unsafeUnwrap().module;
    expect(generated).toContain(
      'export type QueryCursorPage = { limit: number; nextCursor: string | null; total?: number };'
    );
    expect(generated).toContain('"after"?: string;');
    expect(generated).toContain('QueryPageResult<QueryRows["browse"], QueryCursorPage>');
    expect(generated).toContain(
      'QueryPageResult<QueryRows["totals"], QueryCursorPage & { total: number }>'
    );
    expect(generated).toContain('QueryPageResult<QueryRows["offset"], QueryOffsetPage>');
    expect(generated).toContain('execute("browse", parameters, false, true)');
    expect(
      parseDataQueryManifest({
        schemaVersion: 1,
        queries: { browse: { result: 'one', definition: records } },
      }).isErr()
    ).toBe(true);
  });
});

describe('generated V7 cursor clients', () => {
  const manifest = () =>
    parseDataQueryManifest({
      schemaVersion: 1,
      queries: {
        browse: { definition: records },
        totals: { definition: { ...records, page: { ...records.page, includeTotal: true } } },
      },
    })._unsafeUnwrap();

  it('preserves terminal/no-total pages and rejects mismatched envelopes without fallback', async () => {
    const generated = generateAppQueryArtifacts(manifest())._unsafeUnwrap().module;
    const requests: unknown[] = [];
    const load = (response: unknown) => {
      const compiled = ts.transpileModule(generated, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      });
      const exports = {};
      const require = (name: string) => {
        if (name === 'server-only') return {};
        if (name === './request')
          return {
            getConfig: () => ({ baseId: 'bseSynthetic' }),
            request: async (path: string, options: unknown) => {
              requests.push({ path, options });
              return response;
            },
          };
        throw new Error(`Unexpected generated dependency ${name}`);
      };
      new Function('require', 'exports', compiled.outputText)(require, exports);
      return exports as {
        queries: {
          browse(parameters?: { after?: string }): Promise<unknown>;
          totals(parameters?: { after?: string }): Promise<unknown>;
        };
      };
    };
    const terminal = { rows: [{ title: 'last' }], page: { limit: 2, nextCursor: null } };
    await expect(
      load({ ok: true, data: terminal }).queries.browse({ after: 'opaque' })
    ).resolves.toEqual(terminal);
    const total = { rows: [], page: { limit: 2, nextCursor: null, total: 9 } };
    await expect(load({ ok: true, data: total }).queries.totals()).resolves.toEqual(total);
    const longPage = {
      rows: [{ title: 'long' }],
      page: {
        limit: 2,
        nextCursor: encodeDataQueryCursor(
          'binding',
          { values: [JSON.stringify('sort-key'.repeat(131072))], id: 'record-long' },
          signingKey
        )._unsafeUnwrap(),
      },
    };
    await expect(load({ ok: true, data: longPage }).queries.browse()).resolves.toEqual(longPage);
    for (const page of [
      { limit: 2, offset: 0, total: 9 },
      { limit: 2 },
      { limit: 2, nextCursor: 5 },
    ])
      await expect(
        load({ ok: true, data: { rows: [], page } }).queries.browse()
      ).rejects.toMatchObject({ code: 'data_query.invalid_response' });
    await expect(load({ ok: true, data: terminal }).queries.totals()).rejects.toMatchObject({
      code: 'data_query.invalid_response',
    });
    await expect(
      load({ ok: false, error: { code: 'data_query.invalid_cursor' } }).queries.browse({
        after: 'stale',
      })
    ).rejects.toMatchObject({ code: 'data_query.invalid_cursor' });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/v2/queries/execute',
          options: expect.objectContaining({
            body: expect.objectContaining({ parameters: { after: 'opaque' } }),
          }),
        }),
      ])
    );
  });

  it('typechecks optional continuation and opt-in total refinement', () => {
    const generated = generateAppQueryArtifacts(manifest())._unsafeUnwrap().module;
    const files: Record<string, string> = {
      '/cursor-types/queries.ts': generated,
      '/cursor-types/request.ts':
        'export declare function request<T>(path:string, options:unknown):Promise<T>; export declare function getConfig(): {baseId:string};',
      '/cursor-types/server-only.d.ts': "declare module 'server-only';",
      '/cursor-types/consumer.ts': `import {queries} from './queries';
queries.browse();
queries.browse({after: 'opaque'});
// @ts-expect-error continuation parameters are strings
queries.browse({after: 1});
async function usePages() {
  const ordinary = await queries.browse();
  const next: string | null = ordinary.page.nextCursor;
  const maybeTotal: number | undefined = ordinary.page.total;
  // @ts-expect-error totals were not requested
  const required: number = ordinary.page.total;
  // @ts-expect-error cursor pages have no offset
  ordinary.page.offset;
  // @ts-expect-error cursor clients return an envelope
  ordinary.map(() => null);
  const counted = await queries.totals();
  const total: number = counted.page.total;
  void next; void maybeTotal; void required; void total;
}
void usePages;`,
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
    const readFile = host.readFile;
    const fileExists = host.fileExists;
    const directoryExists = host.directoryExists;
    host.readFile = (path) => files[path] ?? readFile(path);
    host.fileExists = (path) => path in files || fileExists(path);
    host.directoryExists = (path) => path === '/cursor-types' || Boolean(directoryExists?.(path));
    host.getSourceFile = (path, languageVersion) => {
      const source = host.readFile(path);
      return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion);
    };
    expect(
      ts
        .getPreEmitDiagnostics(ts.createProgram(Object.keys(files), options, host))
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    ).toEqual([]);
  });
});
