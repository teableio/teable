import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { DataQueryDefinition } from './DataQueryDefinition';
import {
  walkDataQueryPredicateExpressions,
  walkDataQueryFormulaExpression,
  type DataQueryExpressionNode,
} from './DataQueryExpression';
import { dataQueryManifestSchema, parseDataQueryManifest } from './DataQueryManifest';
import { collectDataQueryManifestDependencies } from './DataQueryManifestDependencies';
import {
  generatedClientState,
  generateAppQueryArtifacts,
  parseDataQueryManifestText,
} from './DataQueryManifestFiles';
import { dataQueryLintCodes, lintDataQueryManifest } from './DataQueryManifestLint';
import {
  planDataQueryManifestRepair,
  serializeDataQueryManifest,
  type DataQuerySchemaChange,
} from './DataQueryManifestRepair';
import {
  executeDataQueryRequestSchema,
  validateDataQueryRequestSchema,
} from './queryExecutionProtocol';

const rootTable = `tbl${'a'.repeat(16)}`;
const ownerTable = `tbl${'b'.repeat(16)}`;
const departmentTable = `tbl${'c'.repeat(16)}`;
const sharedField = `fld${'1'.repeat(16)}`;
const guardField = `fld${'2'.repeat(16)}`;
const elseField = `fld${'3'.repeat(16)}`;
const ownerLink = `fld${'4'.repeat(16)}`;
const departmentLink = `fld${'5'.repeat(16)}`;
const replacementField = `fld${'6'.repeat(16)}`;

const expressionQuery = () => ({
  mode: 'auto',
  definition: {
    version: 3,
    kind: 'records',
    tableId: rootTable,
    // Declaration order is meaningful: the second hop uses the first alias.
    relations: {
      zOwner: {
        linkFieldId: ownerLink,
        tableId: ownerTable,
        filter: {
          type: 'formula',
          formula: 'NOT(LOWER({title}) = BLANK())',
          references: { title: { type: 'field', fieldId: sharedField } },
        },
      },
      aDepartment: { via: 'zOwner', linkFieldId: departmentLink, tableId: departmentTable },
    },
    parameters: { label: { type: 'string' } },
    select: [
      {
        alias: 'caption',
        expr: {
          type: 'formula',
          formula:
            'IF({condition} = "active", CONCATENATE({root}, {owner}), IF({department}, {department}, {label}))',
          references: {
            condition: { type: 'field', source: 'zOwner', fieldId: sharedField },
            root: { type: 'field', fieldId: sharedField },
            owner: { type: 'field', source: 'zOwner', fieldId: sharedField },
            department: { type: 'field', source: 'aDepartment', fieldId: elseField },
            label: { type: 'parameter', name: 'label' },
          },
        },
      },
    ],
    filter: {
      conjunction: 'or',
      items: [
        {
          fieldId: guardField,
          operator: 'is',
          value: { type: 'parameter', name: 'label' },
          optional: true,
        },
        {
          type: 'formula',
          formula: '{guard} = "ready"',
          references: { guard: { type: 'field', fieldId: guardField } },
        },
      ],
    },
    sort: [{ alias: 'caption', order: 'asc' }],
    page: { limit: 20, includeTotal: true },
  },
  fallback: { sql: 'SELECT secret_sql_that_must_never_run AS caption' },
});

const manifestOf = (query: unknown = expressionQuery()) =>
  parseDataQueryManifest({ schemaVersion: 1, queries: { captions: query } })._unsafeUnwrap();

const repair = (change: DataQuerySchemaChange, query: unknown = expressionQuery()) => {
  const manifest = manifestOf(query);
  return {
    manifest,
    plan: planDataQueryManifestRepair(
      manifest,
      change,
      collectDataQueryManifestDependencies(manifest).queries
    ),
  };
};

const loadClient = (
  module: string,
  request: (path: string, options: unknown) => Promise<unknown>
) => {
  const compiled = ts.transpileModule(module, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  const require = (name: string) => {
    if (name === 'server-only') return {};
    if (name === './request') return { request, getConfig: () => ({ baseId: 'bseSynthetic' }) };
    throw new Error(`Unexpected generated dependency ${name}`);
  };
  new Function('require', 'exports', compiled.outputText)(require, exports);
  return exports as {
    queries: { captions(parameters: { label: string }): Promise<unknown> };
  };
};

describe('expression query lifecycle', () => {
  it('admits explicit v3 expressions while retaining strict legacy and malformed AST boundaries', () => {
    const definition = manifestOf().queries.captions.definition!;
    expect(executeDataQueryRequestSchema.safeParse({ definition }).success).toBe(true);
    for (const version of [1, 2]) {
      expect(
        executeDataQueryRequestSchema.safeParse({ definition: { ...definition, version } }).success
      ).toBe(false);
      expect(
        executeDataQueryRequestSchema.safeParse({
          definition: {
            version,
            kind: 'records',
            tableId: rootTable,
            select: [{ fieldId: sharedField, alias: 'title' }],
          },
        }).success
      ).toBe(true);
    }
    expect(
      executeDataQueryRequestSchema.safeParse({ definition: { ...definition, version: 4 } }).success
    ).toBe(true);
    for (const expr of [
      { type: 'sql', sql: 'SELECT 1' },
      { type: 'field', fieldId: sharedField },
      { type: 'system', system: 'id' },
      { type: 'parameter', name: 'label' },
      { type: 'literal', value: 'text' },
      { type: 'formula', formula: '', references: {} },
      {
        type: 'formula',
        formula: 'LOWER({title})',
        references: { title: { type: 'literal', value: 'x' } },
      },
      { type: 'formula', formula: 'LOWER({title})' },
      { type: 'literal', value: 'text', injected: true },
      { type: 'formula', formula: 'IF(1, 1)', references: {}, injected: true },
    ]) {
      expect(
        executeDataQueryRequestSchema.safeParse({
          definition: {
            ...definition,
            select: [{ alias: 'caption', expr }],
          },
        }).success
      ).toBe(false);
    }
    for (const filter of [
      {
        left: { type: 'field', fieldId: guardField },
        operator: 'eq',
        right: { type: 'literal', value: 'ready' },
      },
      { operand: { type: 'field', fieldId: guardField }, operator: 'isNotNull' },
    ]) {
      expect(
        executeDataQueryRequestSchema.safeParse({ definition: { ...definition, filter } }).success
      ).toBe(false);
    }
  });

  it('rejects accessors at public schema boundaries before reading definition properties', () => {
    let reads = 0;
    const hostile = Object.defineProperty({}, 'definition', {
      enumerable: true,
      get: () => {
        reads++;
        throw new Error('Accessor must never execute');
      },
    });
    expect(executeDataQueryRequestSchema.safeParse(hostile).success).toBe(false);
    expect(validateDataQueryRequestSchema.safeParse(hostile).success).toBe(false);
    expect(
      dataQueryManifestSchema.safeParse({ schemaVersion: 1, queries: { hostile } }).success
    ).toBe(false);
    expect(reads).toBe(0);
  });

  it('bounds recursive expression input before public request or manifest grammar parsing', () => {
    const reference = { type: 'field', fieldId: sharedField };
    let deepFilter: unknown = { type: 'formula', formula: '1 = 1', references: {} };
    for (let depth = 0; depth < 65; depth++) {
      deepFilter = { conjunction: 'and', items: [deepFilter] };
    }
    const cyclic = {
      type: 'formula',
      formula: '{self}',
      references: {} as Record<string, unknown>,
    };
    cyclic.references.self = cyclic;
    const base = {
      version: 3,
      kind: 'records',
      tableId: rootTable,
      select: [{ alias: 'caption', expr: { type: 'formula', formula: '1', references: {} } }],
    };
    for (const definition of [
      { ...base, select: [{ alias: 'caption', expr: cyclic }] },
      { ...base, filter: deepFilter },
    ]) {
      expect(executeDataQueryRequestSchema.safeParse({ definition }).success).toBe(false);
      expect(validateDataQueryRequestSchema.safeParse({ definition }).success).toBe(false);
      expect(
        dataQueryManifestSchema.safeParse({
          schemaVersion: 1,
          queries: { bounded: { definition } },
        }).success
      ).toBe(false);
    }
    const definition = {
      version: 3,
      kind: 'records',
      tableId: rootTable,
      select: Array.from({ length: 9 }, (_, index) => ({
        alias: `caption${index}`,
        expr: {
          type: 'formula',
          formula: 'CONCATENATE({ref0}, {ref1})',
          references: Object.fromEntries(
            Array.from({ length: 16 }, (_, ref) => [`ref${ref}`, reference])
          ),
        },
      })),
    };
    expect(executeDataQueryRequestSchema.safeParse({ definition }).success).toBe(false);
    expect(
      dataQueryManifestSchema.safeParse({ schemaVersion: 1, queries: { bounded: { definition } } })
        .success
    ).toBe(false);
  });

  it('round-trips v3 fallback metadata without requiring SQL expression parity', () => {
    const manifest = manifestOf();
    const reparsed = parseDataQueryManifestText(
      serializeDataQueryManifest(manifest)
    )._unsafeUnwrap();
    expect(reparsed).toEqual(manifest);
    const generated = generateAppQueryArtifacts(manifest)._unsafeUnwrap();
    expect(generatedClientState(generated.module)).toBe('current');
  });

  it('indexes every IF condition/result/else reference and relation predicate in its own source scope', () => {
    const index = collectDataQueryManifestDependencies(manifestOf());
    expect(index.incompleteQueryIds).toEqual([]);
    expect(index.queries[0]).toMatchObject({
      complete: true,
      fields: expect.arrayContaining([
        { fieldId: sharedField, usages: expect.arrayContaining(['projection']) },
        { fieldId: guardField, usages: expect.arrayContaining(['filter']) },
        { fieldId: ownerLink, usages: expect.arrayContaining(['relation']) },
      ]),
      relations: [
        {
          alias: 'zOwner',
          tableId: ownerTable,
          fields: expect.arrayContaining([
            { fieldId: sharedField, usages: expect.arrayContaining(['projection', 'filter']) },
            { fieldId: departmentLink, usages: expect.arrayContaining(['relation']) },
          ]),
        },
        {
          alias: 'aDepartment',
          tableId: departmentTable,
          fields: [{ fieldId: elseField, usages: expect.arrayContaining(['projection']) }],
        },
      ],
    });
    expect(
      index.tables
        .find((table) => table.tableId === rootTable)
        ?.fields.some((field) => field.fieldId === elseField)
    ).toBe(false);
  });

  it('rewrites nested expression fields source-qualifiably without touching the same root id', () => {
    const { plan } = repair({
      kind: 'field_replaced',
      tableId: ownerTable,
      fieldId: sharedField,
      replacementFieldId: replacementField,
      outputCompatible: true,
    });
    expect(plan.applyable).toBe(true);
    expect(plan.queries[0]).toMatchObject({
      classification: 'auto',
      reasons: ['field_reference_rewritten'],
    });
    const definition = plan.repaired!.queries.captions.definition!;
    if (definition.version !== 3 || definition.kind !== 'records')
      throw new Error('Expected v3 records');
    const fields: Array<{ source: string; fieldId: string }> = [];
    const collect = (defaultSource: string) => (node: DataQueryExpressionNode) => {
      if (node.type === 'field')
        fields.push({ source: node.source ?? defaultSource, fieldId: node.fieldId });
    };
    for (const projection of definition.select) {
      if ('expr' in projection) walkDataQueryFormulaExpression(projection.expr, collect('root'));
    }
    walkDataQueryPredicateExpressions(definition.relations!.zOwner.filter!, collect('zOwner'));
    expect(fields.filter((field) => field.source === 'zOwner')).toEqual([
      { source: 'zOwner', fieldId: replacementField },
      { source: 'zOwner', fieldId: replacementField },
      { source: 'zOwner', fieldId: replacementField },
    ]);
    expect(fields).toContainEqual({ source: 'root', fieldId: sharedField });
    expect(
      parseDataQueryManifestText(serializeDataQueryManifest(plan.repaired!))._unsafeUnwrap()
    ).toEqual(plan.repaired);
  });

  it('rewrites IF else references and keeps mixed OR predicates structurally intact', () => {
    const otherwise = repair({
      kind: 'field_replaced',
      tableId: departmentTable,
      fieldId: elseField,
      replacementFieldId: replacementField,
      outputCompatible: true,
    }).plan;
    expect(otherwise.applyable).toBe(true);
    expect(otherwise.repaired!.queries.captions.definition).toMatchObject({
      select: [
        {
          expr: {
            formula:
              'IF({condition} = "active", CONCATENATE({root}, {owner}), IF({department}, {department}, {label}))',
            references: {
              department: { type: 'field', source: 'aDepartment', fieldId: replacementField },
              label: { type: 'parameter', name: 'label' },
            },
          },
        },
      ],
    });
    const mixed = repair({
      kind: 'field_replaced',
      tableId: rootTable,
      fieldId: guardField,
      replacementFieldId: replacementField,
      outputCompatible: true,
    }).plan;
    expect(mixed.applyable).toBe(true);
    expect(mixed.repaired!.queries.captions.definition!.filter).toEqual({
      conjunction: 'or',
      items: [
        {
          fieldId: replacementField,
          operator: 'is',
          value: { type: 'parameter', name: 'label' },
          optional: true,
        },
        {
          type: 'formula',
          formula: '{guard} = "ready"',
          references: { guard: { type: 'field', fieldId: replacementField } },
        },
      ],
    });
  });

  it.each([
    { tableId: ownerTable, fieldId: sharedField },
    { tableId: departmentTable, fieldId: elseField },
    { tableId: rootTable, fieldId: guardField },
    { tableId: rootTable, fieldId: ownerLink },
  ])(
    'does not prune an expression operand or predicate on deletion: $tableId/$fieldId',
    (target) => {
      const { plan } = repair({ kind: 'field_deleted', ...target });
      expect(plan.applyable).toBe(false);
      expect(plan.queries[0]).toMatchObject({
        classification: 'manual',
        reasons: ['expression_semantics_changed'],
        actions: [],
      });
      expect(plan.preview).toBeUndefined();
      expect(plan.repaired).toBeUndefined();
    }
  );

  it('blocks expression source removal and type changes even when output shape stays compatible', () => {
    for (const change of [
      { kind: 'table_deleted', tableId: ownerTable },
      {
        kind: 'field_updated',
        tableId: ownerTable,
        fieldId: sharedField,
        typeChanged: true,
        outputCompatible: true,
      },
    ] satisfies DataQuerySchemaChange[]) {
      const { plan } = repair(change);
      expect(plan.queries[0]).toMatchObject({
        classification: 'manual',
        reasons: ['expression_semantics_changed'],
        actions: [],
      });
      expect(plan.preview).toBeUndefined();
    }
  });

  it('rejects stale live aliases instead of generating a misleading expression output contract', () => {
    const manifest = manifestOf();
    expect(
      generateAppQueryArtifacts(manifest, {
        captions: {
          outputs: [
            {
              alias: 'wrong',
              wireType: 'string',
              cellValueType: 'string',
              isMultipleCellValue: false,
              nullable: false,
            },
          ],
        },
      })._unsafeUnwrapErr().code
    ).toBe('data_query.manifest_outputs');
  });

  it('rejects malformed total envelopes and never activates frozen SQL after an expression error', async () => {
    const generated = generateAppQueryArtifacts(manifestOf())._unsafeUnwrap();
    const malformed = loadClient(generated.module, async () => ({
      ok: true,
      data: { rows: [{ caption: 'shown' }] },
    }));
    await expect(malformed.queries.captions({ label: 'missing' })).rejects.toMatchObject({
      code: 'data_query.invalid_response',
    });
    const paths: string[] = [];
    const failed = loadClient(generated.module, async (path) => {
      paths.push(path);
      return {
        ok: false,
        error: {
          code: 'data_query.expression_division_by_zero',
          message: 'private operand',
        },
      };
    });
    await expect(failed.queries.captions({ label: 'missing' })).rejects.toMatchObject({
      name: 'QueryError',
      code: 'data_query.expression_division_by_zero',
      queryId: 'captions',
    });
    expect(paths).toEqual(['/v2/queries/execute']);
  });

  it('keeps dependent relation declarations admissible after generated-client serialization', async () => {
    const generated = generateAppQueryArtifacts(manifestOf())._unsafeUnwrap();
    const client = loadClient(generated.module, async (_path, options) => {
      if (options === null || typeof options !== 'object' || !('body' in options)) {
        throw new Error('Expected an execution request');
      }
      const input = executeDataQueryRequestSchema.parse(options.body);
      // Alphabetically sorting aDepartment before zOwner would make this real admission fail.
      const definition = DataQueryDefinition.create(input.definition)._unsafeUnwrap();
      const bound = definition.bind(input.parameters ?? {})._unsafeUnwrap();
      return {
        ok: true,
        data: { rows: [], page: { limit: bound.limit, offset: bound.offset, total: 0 } },
      };
    });
    await expect(client.queries.captions({ label: 'fallback' })).resolves.toMatchObject({
      page: { limit: 20, offset: 0, total: 0 },
    });
  });

  it('does not classify parameterized expression variants as a literal cross-product', () => {
    const queries = Object.fromEntries(
      [0, 1, 2, 3].map((value) => {
        const query = expressionQuery();
        return [
          `caption${value}`,
          {
            ...query,
            definition: { ...query.definition, page: { limit: value + 1, includeTotal: true } },
          },
        ];
      })
    );
    const manifest = parseDataQueryManifest({ schemaVersion: 1, queries })._unsafeUnwrap();
    const findings = lintDataQueryManifest({ text: JSON.stringify(manifest), manifest });
    expect(
      findings.some((finding) => finding.code === dataQueryLintCodes.combinatorialManifest)
    ).toBe(false);
    expect(
      findings.filter((finding) => finding.code === dataQueryLintCodes.autoSqlFallback)
    ).toHaveLength(4);
    expect(findings.some((finding) => finding.code === dataQueryLintCodes.sqlQueryFrozen)).toBe(
      false
    );
  });

  it('includes v3 relation identities in the combinatorial lint shape', () => {
    const queries = Object.fromEntries(
      ['b', 'c', 'd', 'e'].map((suffix, index) => [
        `report${index}`,
        {
          definition: {
            version: 3,
            kind: 'records',
            tableId: rootTable,
            relations: { owner: { linkFieldId: ownerLink, tableId: `tbl${suffix.repeat(16)}` } },
            select: [{ system: 'id', alias: 'id' }],
            filter: {
              type: 'formula',
              formula: `{value} = ${index}`,
              references: { value: { type: 'field', fieldId: sharedField } },
            },
          },
        },
      ])
    );
    const manifest = parseDataQueryManifest({ schemaVersion: 1, queries })._unsafeUnwrap();
    expect(
      lintDataQueryManifest({ text: JSON.stringify(manifest), manifest }).some(
        (finding) => finding.code === dataQueryLintCodes.combinatorialManifest
      )
    ).toBe(false);
  });

  it('keeps a v3 empty-definition repair manual instead of activating frozen SQL metadata', () => {
    const { plan } = repair(
      { kind: 'field_deleted', tableId: rootTable, fieldId: sharedField },
      {
        mode: 'auto',
        definition: {
          version: 3,
          kind: 'records',
          tableId: rootTable,
          select: [{ fieldId: sharedField, alias: 'caption' }],
        },
        fallback: { sql: 'SELECT 1 AS caption' },
      }
    );
    expect(plan.applyable).toBe(false);
    expect(plan.queries[0]).toMatchObject({
      classification: 'manual',
      reasons: ['field_deleted_projection', 'definition_empty'],
    });
    expect(plan.queries[0].actions.some((action) => action.kind === 'switch_to_fallback')).toBe(
      false
    );
    expect(plan.preview?.queries.captions.mode).toBe('auto');
    expect(plan.preview?.queries.captions.definition?.version).toBe(3);
  });

  it('typechecks generated expression output nullability, required parameters and page envelopes', () => {
    const generated = generateAppQueryArtifacts(manifestOf(), {
      captions: {
        outputs: [
          {
            alias: 'caption',
            wireType: 'string',
            cellValueType: 'string',
            isMultipleCellValue: false,
            nullable: true,
          },
        ],
      },
    })._unsafeUnwrap();
    const files: Record<string, string> = {
      '/expression-types/queries.ts': generated.module,
      '/expression-types/request.ts':
        'export declare function request<T>(path:string, options:unknown):Promise<T>; export declare function getConfig(): {baseId:string};',
      '/expression-types/server-only.d.ts': "declare module 'server-only';",
      '/expression-types/consumer.ts': `import {queries, QueryRows} from './queries';
queries.captions({label: 'fallback'});
// @ts-expect-error an expression occurrence keeps the otherwise optional parameter required
queries.captions();
// @ts-expect-error expression input remains a declared string parameter
queries.captions({label: 1});
const row: QueryRows['captions'] = {caption: null};
// @ts-expect-error live expression output is text, never numeric
const wrong: QueryRows['captions'] = {caption: 42};
async function usePage() {
  const result = await queries.captions({label: 'fallback'});
  const total: number = result.page.total;
  const caption: string | null = result.rows[0]!.caption;
  // @ts-expect-error total-enabled clients return an envelope, not an array
  result.map(() => null);
  void total; void caption;
}
void row; void wrong; void usePage;`,
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
    host.directoryExists = (path) =>
      path === '/expression-types' || Boolean(directoryExists?.(path));
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

describe('V5 existence lifecycle', () => {
  const query = () => ({
    mode: 'structured',
    definition: {
      version: 5,
      kind: 'records',
      tableId: rootTable,
      relations: {
        owner: {
          linkFieldId: ownerLink,
          tableId: ownerTable,
          filter: {
            fieldId: sharedField,
            operator: 'is',
            value: { type: 'field', fieldId: guardField },
          },
        },
        department: {
          via: 'owner',
          linkFieldId: departmentLink,
          tableId: departmentTable,
          filter: {
            conjunction: 'and',
            items: [
              {
                fieldId: sharedField,
                operator: 'is',
                value: { type: 'parameter', name: 'status' },
                optional: true,
              },
              {
                type: 'formula',
                formula: '1 = 1',
                references: { unused: { type: 'field', fieldId: elseField } },
              },
            ],
          },
        },
      },
      parameters: { status: { type: 'string' } },
      select: [{ system: 'id', alias: 'id' }],
      filter: { not: { relation: 'department', quantifier: 'none' } },
    },
  });

  it('indexes intermediate Links, field operands and unused leaf formula references', () => {
    const manifest = manifestOf(query());
    const index = collectDataQueryManifestDependencies(manifest);
    expect(index.queries[0]).toMatchObject({
      complete: true,
      relations: [
        {
          alias: 'owner',
          tableId: ownerTable,
          fields: expect.arrayContaining([
            { fieldId: sharedField, usages: ['filter', 'existence'] },
            { fieldId: guardField, usages: ['reference', 'existence'] },
            { fieldId: departmentLink, usages: ['relation'] },
          ]),
        },
        {
          alias: 'department',
          tableId: departmentTable,
          fields: expect.arrayContaining([
            { fieldId: sharedField, usages: ['filter', 'existence'] },
            { fieldId: elseField, usages: ['filter', 'reference', 'existence'] },
          ]),
        },
      ],
    });
    const artifacts = generateAppQueryArtifacts(manifest)._unsafeUnwrap();
    expect(generatedClientState(artifacts.module)).toBe('current');
    expect(
      executeDataQueryRequestSchema.safeParse({ definition: manifest.queries.captions.definition })
        .success
    ).toBe(true);
  });

  it('blocks every selected-path deletion, replacement and type change before generic pruning', () => {
    const changes: DataQuerySchemaChange[] = [
      { kind: 'table_deleted', tableId: ownerTable },
      { kind: 'table_deleted', tableId: departmentTable },
      ...[
        [rootTable, ownerLink],
        [ownerTable, departmentLink],
        [ownerTable, sharedField],
        [ownerTable, guardField],
        [departmentTable, sharedField],
        [departmentTable, elseField],
      ].flatMap(([tableId, fieldId]): DataQuerySchemaChange[] => [
        { kind: 'field_deleted', tableId, fieldId },
        {
          kind: 'field_replaced',
          tableId,
          fieldId,
          replacementFieldId: replacementField,
          outputCompatible: true,
        },
        { kind: 'field_updated', tableId, fieldId, typeChanged: true, outputCompatible: true },
      ]),
    ];
    for (const change of changes) {
      const { manifest, plan } = repair(change, query());
      expect(plan.applyable).toBe(false);
      expect(plan.queries[0]).toMatchObject({
        classification: 'manual',
        reasons: ['filter_semantics_changed'],
        actions: [],
      });
      expect(plan.preview).toBeUndefined();
      expect(plan.repaired).toBeUndefined();
      expect(manifest.queries.captions.definition).toEqual(
        manifestOf(query()).queries.captions.definition
      );
    }
  });

  it('keeps field-free membership dependent on the entire selected path', () => {
    const value = query();
    const fieldFree = {
      ...value,
      definition: {
        ...value.definition,
        relations: {
          owner: { linkFieldId: ownerLink, tableId: ownerTable },
          department: { via: 'owner', linkFieldId: departmentLink, tableId: departmentTable },
        },
      },
    };
    for (const change of [
      { kind: 'table_deleted', tableId: ownerTable },
      { kind: 'field_deleted', tableId: ownerTable, fieldId: departmentLink },
    ] satisfies DataQuerySchemaChange[]) {
      expect(repair(change, fieldFree).plan.queries[0]).toMatchObject({
        classification: 'manual',
        actions: [],
      });
    }
  });

  it('distinguishes any/none in duplicate lint fingerprints', () => {
    const first = query();
    const second = query();
    second.definition.filter.not.quantifier = 'any';
    const manifest = parseDataQueryManifest({
      schemaVersion: 1,
      queries: { first, second },
    })._unsafeUnwrap();
    expect(
      lintDataQueryManifest({ text: JSON.stringify(manifest), manifest }).some(
        (finding) => finding.code === dataQueryLintCodes.duplicateDefinition
      )
    ).toBe(false);
  });

  it('inherits V4 HAVING lint identity and parameter requirements', () => {
    const value = query().definition;
    const { select: _select, ...common } = value;
    const aggregate = {
      ...common,
      kind: 'aggregate',
      aggregates: [{ fieldId: sharedField, statisticFunc: 'count', alias: 'total' }],
      having: {
        type: 'formula',
        formula: '{total} > {minimum}',
        references: {
          total: { type: 'output', alias: 'total' },
          minimum: { type: 'parameter', name: 'minimum' },
        },
      },
      parameters: { ...common.parameters, minimum: { type: 'number' } },
    };
    const manifest = parseDataQueryManifest({
      schemaVersion: 1,
      queries: {
        first: { definition: aggregate },
        second: {
          definition: {
            ...aggregate,
            having: { ...aggregate.having, formula: '{total} < {minimum}' },
          },
        },
      },
    })._unsafeUnwrap();
    expect(
      lintDataQueryManifest({ text: JSON.stringify(manifest), manifest }).some(
        (finding) => finding.code === dataQueryLintCodes.duplicateDefinition
      )
    ).toBe(false);
    expect(
      DataQueryDefinition.create(aggregate)._unsafeUnwrap().bind({})._unsafeUnwrapErr().code
    ).toBe('data_query.missing_parameter');
  });
});
