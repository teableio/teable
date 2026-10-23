import { describe, expect, it } from 'vitest';

import { parseDataQueryManifestText } from './DataQueryManifestFiles';
import {
  dataQueryLintCodes,
  lintDataQueryManifest,
  scanDataQueryUsage,
  type DataQueryLintFinding,
} from './DataQueryManifestLint';
import type { DataQueryDefinitionInput } from './types';

const tableId = `tbl${'a'.repeat(16)}`;
const fieldId = `fld${'b'.repeat(16)}`;
const otherFieldId = `fld${'c'.repeat(16)}`;

const recordsDefinition = (
  extra: Partial<DataQueryDefinitionInput> = {}
): DataQueryDefinitionInput =>
  ({
    version: 1,
    kind: 'records',
    tableId,
    select: [{ fieldId, alias: 'title' }],
    ...extra,
  }) as DataQueryDefinitionInput;

const parse = (queries: Record<string, unknown>) => {
  const text = JSON.stringify({ schemaVersion: 1, queries });
  return { text, manifest: parseDataQueryManifestText(text)._unsafeUnwrap() };
};
const codesOf = (findings: DataQueryLintFinding[]) => findings.map((finding) => finding.code);

describe('lintDataQueryManifest', () => {
  it('reports byte-normalized duplicate definitions', () => {
    const first = { definition: recordsDefinition() };
    const second = {
      definition: {
        select: [{ alias: 'title', fieldId }],
        tableId,
        kind: 'records',
        version: 1,
      },
    };
    const { text, manifest } = parse({ listTodos: first, listTodosCopy: second });
    const finding = lintDataQueryManifest({ text, manifest }).find(
      (entry) => entry.code === dataQueryLintCodes.duplicateDefinition
    );
    expect(finding).toMatchObject({
      severity: 'warning',
      queryId: 'listTodos',
      queryIds: ['listTodos', 'listTodosCopy'],
      location: 'queries.listTodos',
    });
    expect(finding?.message).toContain('identical');
  });

  it('reports query count above the configured limit', () => {
    const { text, manifest } = parse({
      first: { definition: recordsDefinition({ filter: { fieldId, operator: 'is', value: 1 } }) },
      second: { definition: recordsDefinition({ filter: { fieldId, operator: 'is', value: 2 } }) },
    });
    const findings = lintDataQueryManifest({ text, manifest, limits: { maxQueries: 1 } });
    expect(codesOf(findings)).toContain(dataQueryLintCodes.queryCount);
    expect(
      findings.find((entry) => entry.code === dataQueryLintCodes.queryCount)?.message
    ).toContain('2 named queries');
  });

  it('reports manifest and generated client size above limits', () => {
    const { text, manifest } = parse({ only: { definition: recordsDefinition() } });
    const findings = lintDataQueryManifest({
      text,
      manifest,
      generatedClientBytes: 100,
      generatedClientLocation: 'lib/queries.ts',
      limits: { maxManifestBytes: 10, maxClientBytes: 50 },
    });
    expect(codesOf(findings)).toEqual(
      expect.arrayContaining([
        dataQueryLintCodes.manifestSize,
        dataQueryLintCodes.generatedClientSize,
      ])
    );
  });

  it('reports a literal filter/sort cross-product once per shared shape', () => {
    const queries: Record<string, unknown> = {};
    for (const order of ['asc', 'desc'] as const)
      for (const value of ['open', 'closed'])
        queries[`list${order}${value}`] = {
          definition: recordsDefinition({
            filter: { fieldId, operator: 'is', value },
            sort: [{ fieldId, order }],
          }),
        };
    const { text, manifest } = parse(queries);
    const findings = lintDataQueryManifest({ text, manifest });
    const combinatorial = findings.filter(
      (entry) => entry.code === dataQueryLintCodes.combinatorialManifest
    );
    expect(combinatorial).toHaveLength(1);
    expect(combinatorial[0]).toMatchObject({
      severity: 'warning',
      queryIds: Object.keys(queries).sort(),
    });
    expect(combinatorial[0].message).toContain('declared parameters');
    expect(combinatorial[0].message).toMatch(/optional filter|parameterized sort/);
  });

  it('does not flag parameterized variants as combinatorial', () => {
    const queries: Record<string, unknown> = {};
    for (const name of ['a', 'b', 'c', 'd'])
      queries[`list${name}`] = {
        definition: recordsDefinition({
          parameters: { status: { type: 'string' } },
          filter: { fieldId, operator: 'is', value: { type: 'parameter', name: 'status' } },
          sort: [{ fieldId, order: 'asc' }],
        }),
      };
    const { text, manifest } = parse(queries);
    expect(codesOf(lintDataQueryManifest({ text, manifest }))).not.toContain(
      dataQueryLintCodes.combinatorialManifest
    );
  });

  it('still reports literal variants when a parameterized query shares their shape', () => {
    const queries: Record<string, unknown> = {};
    for (const order of ['asc', 'desc'] as const)
      for (const value of ['open', 'closed'])
        queries[`list${order}${value}`] = {
          definition: recordsDefinition({
            filter: { fieldId, operator: 'is', value },
            sort: [{ fieldId, order }],
          }),
        };
    queries.parameterized = {
      definition: recordsDefinition({
        parameters: { status: { type: 'string' } },
        filter: { fieldId, operator: 'is', value: { type: 'parameter', name: 'status' } },
      }),
    };
    const { text, manifest } = parse(queries);
    const finding = lintDataQueryManifest({ text, manifest }).find(
      (entry) => entry.code === dataQueryLintCodes.combinatorialManifest
    );
    expect(finding?.queryIds).toEqual(
      ['listascclosed', 'listascopen', 'listdescclosed', 'listdescopen'].sort()
    );
    expect(finding?.queryIds).not.toContain('parameterized');
  });

  it('reports statically unused queries when usage is conclusive', () => {
    const { text, manifest } = parse({
      used: { definition: recordsDefinition() },
      unused: { definition: recordsDefinition({ recordId: 'rec00000000000001' }) },
    });
    const findings = lintDataQueryManifest({
      text,
      manifest,
      usage: { scannedFiles: 1, referencedQueryIds: ['used'], hasDynamicAccess: false },
    });
    const unused = findings.filter((entry) => entry.code === dataQueryLintCodes.unusedQuery);
    expect(unused).toHaveLength(1);
    expect(unused[0]).toMatchObject({ queryId: 'unused', severity: 'warning' });
  });

  it('reports inconclusive usage as info and never claims a query is unused', () => {
    const { text, manifest } = parse({ used: { definition: recordsDefinition() } });
    const findings = lintDataQueryManifest({
      text,
      manifest,
      usage: { scannedFiles: 2, referencedQueryIds: [], hasDynamicAccess: true },
    });
    expect(codesOf(findings)).toEqual([dataQueryLintCodes.queryUsageUnknown]);
    expect(findings[0].severity).toBe('info');
  });

  it('reports incomplete scans as info instead of unused warnings', () => {
    const { text, manifest } = parse({ only: { definition: recordsDefinition() } });
    const findings = lintDataQueryManifest({
      text,
      manifest,
      usage: {
        scannedFiles: 1,
        referencedQueryIds: [],
        hasDynamicAccess: false,
        complete: false,
      },
    });
    expect(findings).toEqual([
      expect.objectContaining({ code: dataQueryLintCodes.queryUsageUnknown, severity: 'info' }),
    ]);
  });

  it('skips unused detection when no App sources were scanned', () => {
    const { text, manifest } = parse({ only: { definition: recordsDefinition() } });
    const findings = lintDataQueryManifest({
      text,
      manifest,
      usage: { scannedFiles: 0, referencedQueryIds: [], hasDynamicAccess: false },
    });
    expect(findings).toEqual([
      expect.objectContaining({ code: dataQueryLintCodes.queryUsageUnknown, severity: 'info' }),
    ]);
  });

  it('keeps aggregate queries out of records combinatorial groups', () => {
    const aggregate = {
      definition: {
        version: 1,
        kind: 'aggregate',
        tableId,
        aggregates: [{ fieldId: otherFieldId, statisticFunc: 'count', alias: 'total' }],
      },
    };
    const { text, manifest } = parse({ countA: aggregate, countB: aggregate });
    const findings = lintDataQueryManifest({ text, manifest });
    expect(codesOf(findings)).toEqual([dataQueryLintCodes.duplicateDefinition]);
  });

  it('keeps different relation declarations in separate combinatorial groups', () => {
    const relationDefinition = (targetTableId: string, targetFieldId: string) => ({
      version: 2,
      kind: 'records',
      tableId,
      relations: { owner: { linkFieldId: otherFieldId, tableId: targetTableId } },
      select: [
        { fieldId, alias: 'title' },
        { source: 'owner', fieldId: targetFieldId, alias: 'ownerName' },
      ],
    });
    const { text, manifest } = parse({
      ownerA: { definition: relationDefinition(`tbl${'d'.repeat(16)}`, fieldId) },
      ownerB: { definition: relationDefinition(`tbl${'e'.repeat(16)}`, otherFieldId) },
    });
    const findings = lintDataQueryManifest({
      text,
      manifest,
      limits: { maxCombinatorialVariants: 2 },
    });
    expect(codesOf(findings)).not.toContain(dataQueryLintCodes.combinatorialManifest);
  });
});

describe('scanDataQueryUsage', () => {
  it('collects dotted and literal-bracket references without executing code', () => {
    const scan = scanDataQueryUsage([
      { path: 'app/page.tsx', text: 'queries.listTodos(); queries["getTodo"];' },
      { path: 'app/other.ts', text: "queries['countTodos']" },
    ]);
    expect(scan).toMatchObject({
      scannedFiles: 2,
      hasDynamicAccess: false,
      referencedQueryIds: ['countTodos', 'getTodo', 'listTodos'],
    });
  });

  it('counts optional static member access without reporting unused queries', () => {
    const usage = scanDataQueryUsage([{ path: 'app/page.tsx', text: 'queries?.getTodos();' }]);
    expect(usage).toMatchObject({
      hasDynamicAccess: false,
      referencedQueryIds: ['getTodos'],
    });
    const { text, manifest } = parse({ getTodos: { definition: recordsDefinition() } });
    expect(lintDataQueryManifest({ text, manifest, usage })).toEqual([]);
  });

  it('counts destructured query names, including aliases', () => {
    const scan = scanDataQueryUsage([
      {
        path: 'app/page.tsx',
        text: 'const { listTodos, getTodo: renamed } = queries;',
      },
    ]);
    expect(scan).toMatchObject({
      hasDynamicAccess: false,
      referencedQueryIds: ['getTodo', 'listTodos'],
    });
  });

  it('treats rest and computed destructuring keys as inconclusive', () => {
    for (const text of [
      'const { listTodos, ...rest } = queries;',
      'const { [name]: value } = queries;',
      'const client = queries;',
    ]) {
      expect(scanDataQueryUsage([{ path: 'app/page.tsx', text }])).toMatchObject({
        hasDynamicAccess: true,
      });
    }
  });

  it('distinguishes static backtick access from interpolated template access', () => {
    const staticScan = scanDataQueryUsage([{ path: 'app/page.tsx', text: 'queries[`listTodos`]' }]);
    expect(staticScan).toMatchObject({
      hasDynamicAccess: false,
      referencedQueryIds: ['listTodos'],
    });
    const dynamicScan = scanDataQueryUsage([
      { path: 'app/page.tsx', text: 'queries[`list${suffix}`]' },
    ]);
    expect(dynamicScan).toMatchObject({ hasDynamicAccess: true, referencedQueryIds: [] });
  });

  it.each([
    ['computed key', 'queries[id]'],
    ['optional computed key', 'queries?.[id]'],
    ['quoted expression', 'queries["get" + suffix]'],
    ['import alias', "import { queries as client } from '@/lib/queries'; client.getTodos();"],
    ['reflection', 'Object.keys(queries)'],
    ['spread', 'const all = { ...queries }'],
    ['iteration', 'for (const key of queries) use(key)'],
  ])('marks %s as inconclusive', (_label, text) => {
    expect(scanDataQueryUsage([{ path: 'app/page.tsx', text }])).toMatchObject({
      hasDynamicAccess: true,
      referencedQueryIds: [],
    });
  });
});
