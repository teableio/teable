import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { DATA_QUERY_ARTIFACT_GENERATOR_VERSION } from './DataQueryArtifactProvenance';
import { dataQueryCompositionSource, prepareDataQueryComposition } from './DataQueryComposition';
import { DataQueryDefinition } from './DataQueryDefinition';
import { dataQueryManifestJsonSchema, type DataQueryManifest } from './DataQueryManifest';
import {
  compareAppQueryContracts,
  generateAppQueryArtifacts,
  generatedClientState,
  parseDataQueryManifestText,
  withGeneratedClientDigest,
} from './DataQueryManifestFiles';
import {
  queryLibraryPinNeedsPreview,
  queryLibraryPreviewEvidenceKey,
  queryLibrarySourceDigest,
} from './QueryLibraryPreviewEvidence';

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

function monthComparisonArtifacts() {
  const manifest = parseDataQueryManifestText(`schemaVersion: 1
queries:
  sales:
    mode: library
    library: { id: qlb0123456789abcdef, revision: 2 }
  otherMetric:
    mode: library
    library: { id: qlb0123456789abcdef, revision: 1 }
`)._unsafeUnwrap();
  const description = {
    composition: {
      kind: 'composition' as const,
      source: { id: 'qlb1111111111111111', revision: 1 },
      metrics: [{ alias: 'value', statistic: 'count' as const }],
      metricDimensions: ['month', 'billingMonth', 'region'],
    },
    outputs: [
      {
        alias: 'value',
        wireType: 'numberOrString' as const,
        cellValueType: 'number',
        isMultipleCellValue: false,
        nullable: false,
      },
    ],
    parameters: {
      groupBy: { type: 'string[]' as const },
      where_month: { type: 'string' as const, nullable: true },
      where_billingMonth: { type: 'string' as const, nullable: true },
      where_region: { type: 'string' as const, nullable: true },
    },
    optionalParameters: ['groupBy', 'where_month', 'where_billingMonth', 'where_region'],
  };
  return generateAppQueryArtifacts(manifest, {
    sales: {
      ...description,
      parameters: {
        ...description.parameters,
        compareDimension: { type: 'string' },
        compareMonth: { type: 'string' },
      },
      optionalParameters: [...description.optionalParameters, 'compareDimension', 'compareMonth'],
      monthDimensions: { month: 'America/New_York', billingMonth: 'UTC' },
    },
    otherMetric: description,
  })._unsafeUnwrap();
}

describe('generated client integrity', () => {
  it('requires a live contract and emits a fixed library run without embedding its definition', () => {
    const parsed = parseDataQueryManifestText(
      `schemaVersion: 1\nqueries:\n  sales:\n    mode: library\n    library: { id: qlb0123456789abcdef, revision: 2 }\n`
    );
    if (parsed.isErr()) throw new Error(parsed.error.message);
    expect(generateAppQueryArtifacts(parsed.value).isErr()).toBe(true);
    const source = parseDataQueryManifestText(todo)._unsafeUnwrap().queries.getTodos.definition!;
    const generated = generateAppQueryArtifacts(parsed.value, {
      sales: {
        definition: source,
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
    })._unsafeUnwrap();
    expect(generated.module).toContain('qlb0123456789abcdef');
    expect(generated.module).toContain('/query-library/');
    expect(generated.module).toContain(
      '/base/${encodeURIComponent(baseId!)}/query-library/${encodeURIComponent(library.id)}/revisions/${library.revision}/run'
    );
    expect(generated.module).not.toContain(source.tableId);
    expect(generated.module).toContain('"completed"?: boolean');
  });
  it('generates typed paged composition calls from their live contract', () => {
    const manifest = parseDataQueryManifestText(
      `schemaVersion: 1\nqueries:\n  sales:\n    mode: library\n    library: { id: qlb0123456789abcdef, revision: 2 }\n`
    )._unsafeUnwrap();
    const composition = {
      kind: 'composition' as const,
      source: { id: 'qlb1111111111111111', revision: 1 },
      page: { limit: 10, includeTotal: true },
    };
    const output = {
      alias: 'total',
      cellValueType: 'number',
      wireType: 'numberOrString' as const,
      isMultipleCellValue: false,
      nullable: false,
    };
    const contract = {
      composition,
      parameters: { region: { type: 'string' as const } },
      optionalParameters: ['region'],
      outputs: [output],
    };
    const generated = generateAppQueryArtifacts(manifest, { sales: contract })._unsafeUnwrap();
    expect(generated.module).toContain('"region"?: string');
    expect(generated.module).toContain('"total": number | string');
    expect(generated.module).toContain('QueryPageResult<QueryRows["sales"]>');
    expect(generated.module).toContain('Object.keys(value).every');
    expect(generated.module).not.toContain(composition.source.id);
    expect(
      compareAppQueryContracts(
        { ...contract, result: 'many' },
        { ...contract, optionalParameters: [], result: 'many' }
      )
    ).toContainEqual({ path: 'parameters.region', change: 'narrowed' });
    const one = {
      ...manifest,
      queries: { sales: { ...manifest.queries.sales, result: 'one' as const } },
    };
    expect(generateAppQueryArtifacts(one, { sales: contract }).isErr()).toBe(true);
  });
  it('uses admitted dimensions for pinned metric arguments and nullable row properties', () => {
    const manifest = parseDataQueryManifestText(
      'schemaVersion: 1\nqueries:\n  sales:\n    mode: library\n    library: { id: qlb0123456789abcdef, revision: 2 }\n'
    )._unsafeUnwrap();
    const source = dataQueryCompositionSource({
      version: 1,
      kind: 'records',
      tableId: 'tbl0000000000000001',
      select: [
        { system: 'id', alias: 'region' },
        { system: 'autoNumber', alias: 'month' },
      ],
    })._unsafeUnwrap();
    const outputs = [
      { alias: 'region', wireType: 'string' as const, cellValueType: 'string' },
      { alias: 'month', wireType: 'numberOrString' as const, cellValueType: 'number' },
    ].map((output) => ({ ...output, isMultipleCellValue: false, nullable: false }));
    const contract = (metricDimensions: string[]) => {
      const composition = {
        kind: 'composition' as const,
        source: { id: 'qlb1111111111111111', revision: 1 },
        metrics: [{ alias: 'value', statistic: 'count' as const }],
        metricDimensions,
      };
      return {
        ...prepareDataQueryComposition(composition, outputs, source)._unsafeUnwrap(),
        composition,
        result: 'many' as const,
      };
    };
    const both = contract(['region', 'month']);
    const none = contract([]);
    const client = generateAppQueryArtifacts(manifest, { sales: both })._unsafeUnwrap().module;
    expect(client).toContain('"groupBy"?: Array<"region" | "month">');
    expect(client).toContain('"where_month"?: number | string | null');
    expect(client).toContain('"where_region"?: string | null');
    expect(client).toContain('"region": string | null');
    expect(client).toContain('"month": number | string | null');
    expect(client).toContain('"value": number | string;');
    expect(client).not.toContain(both.composition.source.id);
    expect(generateAppQueryArtifacts(manifest, { sales: none })._unsafeUnwrap().module).toContain(
      '"groupBy"?: []'
    );
    expect(compareAppQueryContracts(both, none)).toContainEqual({
      path: 'parameters.groupBy',
      change: 'narrowed',
    });
    expect(compareAppQueryContracts(none, both)).toEqual([]);
  });
  it('runs the pinned month comparison, unwraps exactly one row and preserves library errors', async () => {
    const generated = monthComparisonArtifacts();
    const row = {
      currentMonth: '2026-02',
      previousMonth: '2026-01',
      current: '40',
      previous: 130,
      difference: -90,
      changeRate: '-0.6923076923076923',
    };
    const source = {
      kind: 'library',
      baseId: 'bseFallback',
      id: 'qlb0123456789abcdef',
      revision: 2,
      name: 'Net receipts',
      monthComparison: {
        dimension: 'month',
        currentMonth: '2026-02',
        previousMonth: '2026-01',
      },
    };
    let response: unknown = { ok: true, data: { rows: [row], source } };
    const requests: unknown[] = [];
    const loaded = loadModule(
      async (endpoint, options) => {
        requests.push({ endpoint, options });
        return response;
      },
      () => ({ baseId: 'bseFallback' }),
      generated
    ) as unknown as {
      compareMetricMonth: { sales(parameters: unknown): Promise<unknown> };
      queries: { sales(parameters: unknown): Promise<unknown> };
    };
    const parameters = { compareMonth: '2026-02', compareDimension: 'month', where_region: 'EU' };

    expect(Object.keys(loaded.compareMetricMonth)).toEqual(['sales']);
    await expect(loaded.compareMetricMonth.sales(parameters)).resolves.toEqual({ ...row, source });
    expect(requests).toEqual([
      {
        endpoint: '/base/bseFallback/query-library/qlb0123456789abcdef/revisions/2/run',
        options: { method: 'POST', acceptErrorResponse: true, body: { parameters } },
      },
    ]);

    await expect(loaded.queries.sales(parameters)).rejects.toMatchObject({
      code: 'data_query.unknown_parameter',
    });
    expect(requests).toHaveLength(1);
    response = {
      ok: true,
      data: { rows: [{ ...row, current: null, difference: null, changeRate: null }], source },
    };
    await expect(loaded.compareMetricMonth.sales(parameters)).resolves.toMatchObject({
      current: null,
    });
    for (const invalidRows of [[], [row, row]]) {
      response = { ok: true, data: { rows: invalidRows } };
      await expect(loaded.compareMetricMonth.sales(parameters)).rejects.toMatchObject({
        code: 'data_query.cardinality',
      });
    }
    response = { ok: true, data: { rows: [{ value: 40 }] } };
    await expect(loaded.compareMetricMonth.sales(parameters)).rejects.toMatchObject({
      code: 'data_query.invalid_response',
    });
    for (const invalidSource of [
      undefined,
      { ...source, id: 'qlb1111111111111111' },
      { ...source, revision: 1 },
      { ...source, monthComparison: { ...source.monthComparison, dimension: 'billingMonth' } },
      { ...source, monthComparison: { ...source.monthComparison, previousMonth: '2025-12' } },
    ]) {
      response = { ok: true, data: { rows: [row], source: invalidSource } };
      await expect(loaded.compareMetricMonth.sales(parameters)).rejects.toMatchObject({
        code: 'data_query.invalid_response',
      });
    }
    response = {
      ok: true,
      data: {
        rows: [{ ...row, previousMonth: '2025-12' }],
        source: {
          ...source,
          monthComparison: { ...source.monthComparison, previousMonth: '2025-12' },
        },
      },
    };
    await expect(loaded.compareMetricMonth.sales(parameters)).rejects.toMatchObject({
      code: 'data_query.invalid_response',
    });
    const january = { ...row, currentMonth: '2026-01', previousMonth: '2025-12' };
    response = {
      ok: true,
      data: {
        rows: [january],
        source: {
          ...source,
          monthComparison: {
            dimension: 'month',
            currentMonth: '2026-01',
            previousMonth: '2025-12',
          },
        },
      },
    };
    await expect(
      loaded.compareMetricMonth.sales({ ...parameters, compareMonth: '2026-01' })
    ).resolves.toMatchObject(january);
    response = { status: 404, code: 'query_library.unavailable', message: 'Revision unavailable' };
    await expect(loaded.compareMetricMonth.sales(parameters)).rejects.toMatchObject({
      code: 'query_library.unavailable',
      message: 'Revision unavailable',
    });
  });

  it('types eligible comparison aliases and keeps ordinary metric arguments and rows distinct', () => {
    const files: Record<string, string> = {
      '/comparison/queries.ts': monthComparisonArtifacts().module,
      '/comparison/request.ts':
        'export declare function request<T>(path:string, options:unknown):Promise<T>; export declare function getConfig(): {baseId:string};',
      '/comparison/server-only.d.ts': "declare module 'server-only';",
      '/comparison/consumer.ts': `import { compareMetricMonth, queries } from './queries';
async function read() {
  const comparison = await compareMetricMonth.sales({ compareMonth: '2026-02', compareDimension: 'month', where_region: 'EU', groupBy: [] });
  const rate: number | string | null = comparison.changeRate;
  const revision: number = comparison.source.revision;
  const month: string = comparison.source.monthComparison.currentMonth;
  const ordinary: Array<{ value: number | string }> = await queries.sales({ groupBy: ['region'], where_month: '2026-02-01' });
  await compareMetricMonth.sales({ compareMonth: '2026-02', compareDimension: 'billingMonth', where_month: '2026-02-01' });
  // @ts-expect-error only eligible month aliases are accepted
  await compareMetricMonth.sales({ compareMonth: '2026-02', compareDimension: 'region' });
  // @ts-expect-error both comparison controls are required
  await compareMetricMonth.sales({ compareMonth: '2026-02' });
  // @ts-expect-error comparison refuses a filter on the selected month alias
  await compareMetricMonth.sales({ compareMonth: '2026-02', compareDimension: 'month', where_month: '2026-02-01' });
  // @ts-expect-error comparison refuses groups
  await compareMetricMonth.sales({ compareMonth: '2026-02', compareDimension: 'month', groupBy: ['region'] });
  // @ts-expect-error ordinary queries have their own output contract
  await queries.sales({ compareMonth: '2026-02', compareDimension: 'month' });
  // @ts-expect-error this pin does not expose month comparison
  await compareMetricMonth.otherMetric({ compareMonth: '2026-02', compareDimension: 'month' });
  void rate; void revision; void month; void ordinary;
}
void read;`,
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
    const read = host.readFile;
    const exists = host.fileExists;
    const directoryExists = host.directoryExists;
    host.readFile = (path) => files[path] ?? read(path);
    host.fileExists = (path) => path in files || exists(path);
    host.directoryExists = (path) => path === '/comparison' || Boolean(directoryExists?.(path));
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

  it('requires review when upgrading a pin drops a comparison alias or changes its timezone', () => {
    const contract = {
      composition: {
        kind: 'composition' as const,
        source: { id: 'qlb1111111111111111', revision: 1 },
        metricDimensions: ['month', 'billingMonth', 'signedMonth'],
        metrics: [{ alias: 'value', statistic: 'count' as const }],
      },
      result: 'many' as const,
      outputs: [],
      parameters: {},
    };
    expect(
      compareAppQueryContracts(
        { ...contract, monthDimensions: { month: 'UTC', billingMonth: 'America/Los_Angeles' } },
        { ...contract, monthDimensions: { month: 'Asia/Tokyo', signedMonth: 'America/New_York' } }
      )
    ).toEqual([
      { path: 'monthDimensions.month', change: 'changed' },
      { path: 'monthDimensions.billingMonth', change: 'removed' },
    ]);
  });

  it('reports incompatible changes when upgrading a pinned revision', () => {
    const definition =
      parseDataQueryManifestText(todo)._unsafeUnwrap().queries.getTodos.definition!;
    const output = {
      alias: 'amount',
      cellValueType: 'number' as const,
      wireType: 'numberOrString' as const,
      isMultipleCellValue: false,
      nullable: false,
    };
    const previous = { definition, outputs: [output], result: 'many' as const };
    const next = {
      definition: { ...definition, parameters: { region: { type: 'string' as const } } },
      outputs: [{ ...output, nullable: true }],
      result: 'one' as const,
    };
    expect(compareAppQueryContracts(previous, next)).toEqual(
      expect.arrayContaining([
        { path: 'parameters.completed', change: 'removed' },
        { path: 'parameters.region', change: 'required_added' },
        { path: 'outputs.amount', change: 'changed' },
        { path: 'result', change: 'changed' },
      ])
    );
  });

  describe('query library preview evidence', () => {
    it('keys evidence to source and keeps the published-pin exception exact', () => {
      const files = [{ path: 'app.ts', content: 'one' }];
      const digest = queryLibrarySourceDigest(files);
      expect(queryLibrarySourceDigest([{ path: 'app.ts', content: 'two' }])).not.toBe(digest);
      const base = {
        baseId: 'base',
        appId: 'app',
        localName: 'sales',
        pin: { id: 'qlb0123456789abcdef', revision: 2 },
        sourceDigest: digest,
      };
      expect(queryLibraryPreviewEvidenceKey(base)).toBe(queryLibraryPreviewEvidenceKey(base));
      expect(queryLibraryPreviewEvidenceKey(base)).not.toBe(
        queryLibraryPreviewEvidenceKey({ ...base, appId: 'other' })
      );
      expect(queryLibraryPinNeedsPreview(base.pin, base.pin, digest, digest)).toBe(false);
      expect(queryLibraryPinNeedsPreview(base.pin, base.pin, digest, 'different')).toBe(true);
      expect(queryLibraryPinNeedsPreview(base.pin, undefined, digest, undefined)).toBe(true);
    });
  });

  it('detects body edits, reseals host transforms and accepts pre-digest clients', () => {
    const module = artifacts().module;
    expect(generatedClientState(module)).toBe('current');

    const edited = module.replace('export const queries =', '// edited\nexport const queries =');
    expect(generatedClientState(edited)).toBe('invalid');
    expect(generatedClientState(withGeneratedClientDigest(edited))).toBe('current');

    expect(
      generatedClientState(module.replace(/^\/\/ Source SHA256: .*$/m, '// Source SHA256: bad'))
    ).toBe('invalid');

    const legacy = module
      .split('\n')
      .filter((line) => !line.startsWith('// Source SHA256: '))
      .join('\n');
    expect(generatedClientState(legacy)).toBe('legacy');
  });

  it('digests provenance while retaining correctly digested pre-stamp accepted clients', () => {
    const module = artifacts().module;
    const stamp = `// Teable query generator: ${DATA_QUERY_ARTIFACT_GENERATOR_VERSION}`;
    expect(module).toContain(`${stamp}\n`);
    expect(generatedClientState(module)).toBe('current');
    const changed = module.replace(stamp, '// Teable query generator: tampered');
    expect(generatedClientState(changed)).toBe('invalid');
    expect(generatedClientState(withGeneratedClientDigest(changed))).toBe('current');
    const historical = withGeneratedClientDigest(module.replace(`${stamp}\n`, ''));
    expect(generatedClientState(historical)).toBe('current');
  });
});

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

const relationQuery = (
  fallback?: Readonly<{ sql: string }>
): DataQueryManifest['queries'][string] => ({
  ...(fallback ? { mode: 'auto' as const } : {}),
  definition: {
    version: 2,
    kind: 'records',
    tableId: `tbl${'a'.repeat(16)}`,
    relations: { owner: { linkFieldId: `fld${'b'.repeat(16)}`, tableId: `tbl${'c'.repeat(16)}` } },
    select: [
      { system: 'id', alias: 'bookId' },
      { system: 'lastModifiedTime', alias: 'bookUpdatedAt' },
      { system: 'id', source: 'owner', alias: 'ownerId' },
      { system: 'createdTime', source: 'owner', alias: 'ownerCreatedAt' },
      { system: 'lastModifiedTime', source: 'owner', alias: 'ownerUpdatedAt' },
      { system: 'autoNumber', source: 'owner', alias: 'ownerSequence' },
      { system: 'version', source: 'owner', alias: 'ownerVersion' },
      { fieldId: `fld${'d'.repeat(16)}`, source: 'owner', alias: 'ownerName' },
    ],
  },
  ...(fallback ? { fallback } : {}),
});

describe('app query manifest files', () => {
  it('generates a callable v4 aggregate client preserving HAVING and exact page totals', async () => {
    const definition = {
      version: 4,
      kind: 'aggregate',
      tableId: `tbl${'a'.repeat(16)}`,
      parameters: { minimum: { type: 'number' } },
      aggregates: [
        {
          alias: 'total',
          statisticFunc: 'sum',
          expr: {
            type: 'formula',
            formula: '{amount} * 2',
            references: { amount: { type: 'field', fieldId: `fld${'b'.repeat(16)}` } },
          },
        },
      ],
      having: {
        type: 'formula',
        formula: '{total} > {minimum}',
        references: {
          total: { type: 'output', alias: 'total' },
          minimum: { type: 'parameter', name: 'minimum' },
        },
      },
      page: { limit: 1, includeTotal: true },
    };
    const manifest = parseDataQueryManifestText(
      JSON.stringify({
        schemaVersion: 1,
        queries: {
          totals: { definition },
        },
      })
    )._unsafeUnwrap();
    const generated = generateAppQueryArtifacts(manifest, {
      totals: {
        outputs: [
          {
            alias: 'total',
            cellValueType: 'number',
            wireType: 'numberOrString',
            isMultipleCellValue: false,
            nullable: true,
          },
        ],
      },
    })._unsafeUnwrap();
    expect(generated.module).toContain('"total": number | string | null');
    const compiled = ts.transpileModule(generated.module, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const exports = {};
    const result = { rows: [{ total: 40 }], page: { limit: 1, offset: 0, total: 1 } };
    const calls: unknown[] = [];
    const require = (name: string) => {
      if (name === 'server-only') return {};
      if (name === './request')
        return {
          getConfig: () => ({ baseId: 'bseTest' }),
          request: async (_endpoint: string, options: unknown) => {
            calls.push(options);
            return { ok: true, data: result };
          },
        };
      throw new Error(`Unexpected dependency ${name}`);
    };
    new Function('require', 'exports', compiled.outputText)(require, exports);
    const client = exports as {
      queries: { totals(parameters: { minimum: number }): Promise<unknown> };
    };
    await expect(client.queries.totals({ minimum: 30 })).resolves.toEqual(result);
    expect(calls).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({
          definition,
          parameters: { minimum: 30 },
          queryId: 'totals',
        }),
      }),
    ]);
  });

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

  it('stamps deterministic canonical artifacts without changing manifest schema compatibility', () => {
    const parsed = parseDataQueryManifestText(todo)._unsafeUnwrap();
    const first = generateAppQueryArtifacts(parsed)._unsafeUnwrap();
    expect(first.module).toContain(
      `// Teable query generator: ${DATA_QUERY_ARTIFACT_GENERATOR_VERSION}\n`
    );
    expect(generatedClientState(first.module)).toBe('current');
    const schema = JSON.parse(first.schema);
    expect(schema['x-teable-query-generator-version']).toBe(DATA_QUERY_ARTIFACT_GENERATOR_VERSION);
    expect(schema).toEqual(dataQueryManifestJsonSchema());
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.properties.schemaVersion).toMatchObject({ const: 1 });
    expect(schema.required).toContain('queries');
    expect(generateAppQueryArtifacts(parsed)._unsafeUnwrap()).toEqual(first);
    expect(parseDataQueryManifestText(JSON.stringify(parsed))._unsafeUnwrap()).toEqual(parsed);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
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
    expect(artifacts().module).toContain(
      `// Teable query generator: ${DATA_QUERY_ARTIFACT_GENERATOR_VERSION}\n`
    );
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

  it('keeps multi-hop relation definitions valid after generating the client', async () => {
    const manifest = parseDataQueryManifestText(
      JSON.stringify({
        schemaVersion: 1,
        queries: {
          getTodos: {
            definition: {
              version: 2,
              kind: 'records',
              tableId: `tbl${'a'.repeat(16)}`,
              relations: {
                zParent: { linkFieldId: `fld${'b'.repeat(16)}`, tableId: `tbl${'c'.repeat(16)}` },
                mChild: {
                  via: 'zParent',
                  linkFieldId: `fld${'d'.repeat(16)}`,
                  tableId: `tbl${'e'.repeat(16)}`,
                },
                aGrandchild: {
                  via: 'mChild',
                  linkFieldId: `fld${'f'.repeat(16)}`,
                  tableId: `tbl${'g'.repeat(16)}`,
                },
                bPeer: { linkFieldId: `fld${'h'.repeat(16)}`, tableId: `tbl${'i'.repeat(16)}` },
              },
              select: [
                { system: 'id', alias: 'id' },
                { source: 'aGrandchild', system: 'id', alias: 'descendantId' },
                { source: 'bPeer', system: 'id', alias: 'peerId' },
              ],
            },
          },
        },
      })
    )._unsafeUnwrap();
    let sentDefinition: unknown;
    const generated = loadModule(
      async (_endpoint, options) => {
        if (options === null || typeof options !== 'object' || !('body' in options)) {
          throw new Error('Expected a generated request body');
        }
        const body = options.body;
        if (body === null || typeof body !== 'object' || !('definition' in body)) {
          throw new Error('Expected a generated definition');
        }
        sentDefinition = body.definition;
        return { ok: true, data: { rows: [] } };
      },
      undefined,
      generateAppQueryArtifacts(manifest)._unsafeUnwrap()
    );

    await generated.queries.getTodos();

    const parsedDefinition = DataQueryDefinition.create(sentDefinition);
    if (parsedDefinition.isErr()) throw new Error(parsedDefinition.error.message);
    const definition = parsedDefinition.value.snapshot();
    expect(definition.version).toBe(2);
    if (definition.version !== 2) throw new Error('Expected a relation definition');
    expect(Object.keys(definition.relations ?? {})).toEqual([
      'zParent',
      'mChild',
      'aGrandchild',
      'bPeer',
    ]);
    expect(definition.relations?.aGrandchild.via).toBe('mChild');
    expect(definition.relations?.mChild.via).toBe('zParent');
  });

  it('executes SQL only for mode: sql-query and keeps automatic fallback frozen', async () => {
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
              sql: 'SELECT rank FROM auto_frozen',
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
            fallback: { sql: 'SELECT rank FROM structured_frozen' },
          },
        },
      })
    )._unsafeUnwrap();
    const generated = generateAppQueryArtifacts(parsed)._unsafeUnwrap();
    expect(generated.module).not.toContain('auto_frozen');
    expect(generated.module).not.toContain('structured_frozen');
    const calls: Array<{ endpoint: string; options: unknown }> = [];
    const request = async (endpoint: string, options: unknown) => {
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
    await expect(loaded.queries.autoReport()).rejects.toMatchObject({
      code: 'data_query.unsupported_join',
      queryId: 'autoReport',
    });
    await expect(loaded.queries.fallbackReport()).rejects.toMatchObject({
      code: 'data_query.unsupported_join',
      queryId: 'fallbackReport',
    });
    expect(calls).toHaveLength(3);
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
    expect(calls[2]).toMatchObject({ endpoint: '/v2/queries/execute' });
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

  it.each([false, true])('decodes library HTTP errors with paged client=%s', async (paged) => {
    const { getTodoById } = parseDataQueryManifestText(todo)._unsafeUnwrap().queries;
    const generated = generateAppQueryArtifacts(
      {
        schemaVersion: 1,
        queries: {
          getTodoById,
          getTodos: { mode: 'library', library: { id: 'qlb0123456789abcdef', revision: 2 } },
        },
      },
      {
        getTodos: {
          composition: {
            kind: 'composition',
            source: { id: 'qlb1111111111111111', revision: 1 },
            ...(paged ? { page: { limit: 1, includeTotal: true } } : {}),
          },
          outputs: [],
        },
      }
    )._unsafeUnwrap();
    let response: unknown;
    const { queries } = loadModule(async () => response, undefined, generated);
    const unavailable = {
      status: 409,
      code: 'query_library.source_unavailable',
      message: 'The pinned source revision is unavailable',
    };
    for (const error of [
      unavailable,
      { status: 400, code: 'data_query.metric_group_limit_exceeded', message: 'Too many groups' },
    ]) {
      response = error;
      await expect(queries.getTodos()).rejects.toMatchObject({
        name: 'QueryError',
        queryId: 'getTodos',
        code: error.code,
        message: error.message,
      });
      await expect(queries.getTodoById({ id: 'unused' })).rejects.toMatchObject({
        code: 'data_query.invalid_response',
      });
    }
    response = { ok: false, error: { code: 'data_query.forbidden', message: 'private-data' } };
    await expect(queries.getTodos()).rejects.toMatchObject({
      code: 'data_query.forbidden',
      message: 'Query getTodos failed (data_query.forbidden)',
    });
    for (const malformed of [
      { ...unavailable, message: [] },
      { ...unavailable, code: 'unrecognized' },
      { ...unavailable, status: 200 },
      { ...unavailable, ok: true, data: { rows: [] } },
    ]) {
      response = malformed;
      await expect(queries.getTodos()).rejects.toMatchObject({
        code: 'data_query.invalid_response',
      });
    }
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
    expect(artifacts().module).toContain(
      `// Teable query generator: ${DATA_QUERY_ARTIFACT_GENERATOR_VERSION}\n`
    );
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

  it('infers nullable offline types for joined system projections and keeps root id non-nullable', () => {
    const generated = generateAppQueryArtifacts({
      schemaVersion: 1,
      queries: { ownerBooks: relationQuery() },
    })._unsafeUnwrap();
    const files: Record<string, string> = {
      '/relation-types/queries.ts': generated.module,
      '/relation-types/request.ts':
        'export declare function request<T>(path:string, options:unknown):Promise<T>; export declare function getConfig(): {baseId:string};',
      '/relation-types/server-only.d.ts': "declare module 'server-only';",
      '/relation-types/consumer.ts': `import {queries, QueryRows} from './queries';
const row: QueryRows['ownerBooks'] = {
  bookId: 'recAAAAAAAAAAAAAAAA',
  bookUpdatedAt: null,
  ownerId: null,
  ownerCreatedAt: null,
  ownerUpdatedAt: null,
  ownerSequence: null,
  ownerVersion: null,
  ownerName: 'Ada',
};
const rootId: string = row.bookId;
const joinedId: string | null = row.ownerId;
const joinedCreatedAt: string | null = row.ownerCreatedAt;
const joinedUpdatedAt: string | null = row.ownerUpdatedAt;
const joinedSequence: number | string | null = row.ownerSequence;
const joinedVersion: number | string | null = row.ownerVersion;
// @ts-expect-error root id is never null
const wrongRootId: QueryRows['ownerBooks'] = {...row, bookId: null};
// @ts-expect-error joined id is a string or null, never numeric
const wrongJoinedId: QueryRows['ownerBooks'] = {...row, ownerId: 1};
// @ts-expect-error joined autoNumber is number|string or null, never boolean
const wrongJoinedSequence: QueryRows['ownerBooks'] = {...row, ownerSequence: true};
async function check() {
  const result: Array<typeof row> = await queries.ownerBooks();
  void result;
}
void check; void rootId; void joinedId; void joinedCreatedAt; void joinedUpdatedAt;
void joinedSequence; void joinedVersion; void wrongRootId; void wrongJoinedId; void wrongJoinedSequence;`,
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
      path === '/relation-types' || Boolean(originalDirectoryExists?.(path));
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

  it('rejects real version 2 relation failures without selecting the SQL fallback', async () => {
    const generated = generateAppQueryArtifacts({
      schemaVersion: 1,
      queries: { ownerBooks: relationQuery({ sql: 'SELECT 1 AS bookId' }) },
    })._unsafeUnwrap();
    for (const code of [
      'data_query.join_relationship',
      'data_query.field_forbidden',
      'data_query.join_unsupported',
    ]) {
      const calls: Array<{ endpoint: string; options: unknown }> = [];
      const loaded = loadModule(
        async (endpoint, options) => {
          calls.push({ endpoint, options });
          return { ok: false, error: { code, message: 'relation refused', tags: ['validation'] } };
        },
        () => ({ baseId: 'bseFallback' }),
        generated
      ) as unknown as { queries: { ownerBooks(): Promise<unknown> } };
      await expect(loaded.queries.ownerBooks()).rejects.toMatchObject({
        code,
        queryId: 'ownerBooks',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ endpoint: '/v2/queries/execute' });
    }
  });

  it('generates a mixed manifest that typechecks with narrow per-query results', () => {
    const mixed = generateAppQueryArtifacts({
      schemaVersion: 1,
      queries: {
        paged: {
          result: 'many',
          definition: {
            version: 1,
            kind: 'records',
            tableId: `tbl${'a'.repeat(16)}`,
            select: [{ system: 'id', alias: 'id' }],
            page: { limit: 2, includeTotal: true },
          },
        },
        legacy: {
          result: 'many',
          definition: {
            version: 1,
            kind: 'records',
            tableId: `tbl${'a'.repeat(16)}`,
            select: [{ system: 'id', alias: 'id' }],
          },
        },
        legacyOne: {
          result: 'one',
          definition: {
            version: 1,
            kind: 'records',
            tableId: `tbl${'a'.repeat(16)}`,
            select: [{ system: 'id', alias: 'id' }],
            recordId: `rec${'b'.repeat(16)}`,
          },
        },
      },
    })._unsafeUnwrap().module;
    const files: Record<string, string> = {
      '/mixed/queries.ts': mixed,
      '/mixed/request.ts':
        'export declare function request<T>(path:string, options:unknown):Promise<T>; export declare function getConfig(): {baseId:string};',
      '/mixed/server-only.d.ts': "declare module 'server-only';",
      '/mixed/consumer.ts': `import {queries} from './queries';
async function check() {
  const paged = await queries.paged();
  const total: number = paged.page.total;
  const rows: Array<{id: string}> = await queries.legacy();
  const one: {id: string} | null = await queries.legacyOne();
  // @ts-expect-error legacy queries keep the array result
  const wrongPage = (await queries.legacy()).page;
  void wrongPage;
  void total; void rows; void one;
}
void check;`,
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
    host.directoryExists = (path) => path === '/mixed' || Boolean(originalDirectoryExists?.(path));
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
