import {
  ActorId,
  DefaultTableMapper,
  FunctionName,
  NoopLogger,
  RecordQueryPluginRunner,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { DataQueryBinding } from './DataQueryBinding';
import { dataQueryCapabilities } from './DataQueryCapabilities';
import { DataQueryDefinition } from './DataQueryDefinition';
import { DataQueryExplainService } from './DataQueryExplainService';
import type { DataQueryFormulaExpression } from './DataQueryExpression';
import { collectDataQuerySourceFieldUsages } from './DataQueryFieldUsage';
import { dataQueryManifestSchema, parseDataQueryManifest } from './DataQueryManifest';
import { collectDataQueryManifestDependencies } from './DataQueryManifestDependencies';
import { generateAppQueryArtifacts, parseDataQueryManifestText } from './DataQueryManifestFiles';
import { dataQueryLintCodes, lintDataQueryManifest } from './DataQueryManifestLint';
import { planDataQueryManifestRepair, serializeDataQueryManifest } from './DataQueryManifestRepair';
import { DataQueryService } from './DataQueryService';
import {
  executeDataQueryRequestSchema,
  validateDataQueryRequestSchema,
} from './queryExecutionProtocol';

const tableId = `tbl${'a'.repeat(16)}`;
const targetId = `tbl${'b'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const declaredId = `fld${'b'.repeat(16)}`;
const unrelatedId = `fld${'c'.repeat(16)}`;
const linkId = `fld${'d'.repeat(16)}`;
const missingId = `fld${'e'.repeat(16)}`;
const replacementId = `fld${'f'.repeat(16)}`;
const mapper = new DefaultTableMapper();
const context = { actorId: ActorId.create('reader')._unsafeUnwrap() };

const tableDto = (id = tableId): ITablePersistenceDTO => ({
  id,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Formula lifecycle fixture',
  dbTableName: `formula_query.${id}`,
  primaryFieldId: titleId,
  fields: [
    ...[titleId, declaredId, unrelatedId].map((fieldId, index) => ({
      id: fieldId,
      name: `Title ${index}`,
      dbFieldName: `title_${index}`,
      type: 'singleLineText' as const,
    })),
    ...(id === tableId
      ? [
          {
            id: linkId,
            name: 'Owner',
            dbFieldName: 'owner',
            type: 'link' as const,
            options: {
              relationship: 'manyOne' as const,
              foreignTableId: targetId,
              lookupFieldId: titleId,
              isOneWay: true,
              fkHostTableName: `formula_query.${tableId}`,
              selfKeyName: '__id',
              foreignKeyName: 'fk_owner',
            },
          },
        ]
      : []),
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

const records = (expr: DataQueryFormulaExpression) => ({
  version: 3,
  kind: 'records',
  tableId,
  select: [{ alias: 'caption', expr }],
});
const formula = (): DataQueryFormulaExpression => ({
  type: 'formula',
  formula: 'LOWER({title})',
  references: {
    title: { type: 'field', fieldId: titleId },
    declared: { type: 'field', fieldId: declaredId },
  },
});
const manifestOf = () =>
  parseDataQueryManifest({
    schemaVersion: 1,
    queries: { captions: { definition: records(formula()) } },
  })._unsafeUnwrap();

const serviceFor = (getDto: () => ITablePersistenceDTO) =>
  new DataQueryService(
    { findOne: async () => ok(mapper.toDomain(getDto())._unsafeUnwrap()) },
    new RecordQueryPluginRunner([], new NoopLogger()),
    { execute: async () => ok({ rows: [] }) }
  );

describe('Teable formula query lifecycle', () => {
  it('advertises the existing Teable language rather than a second function registry', () => {
    expect(dataQueryCapabilities.scalarExpressions).toMatchObject({
      language: 'teable-formula',
      functions: Object.values(FunctionName),
      referenceTypes: ['field', 'system', 'parameter'],
    });
    expect(dataQueryCapabilities).not.toHaveProperty('expressionRegistryRevision');
  });

  it('indexes every declared reference, including unused references and relation-local filters', () => {
    const definition = DataQueryDefinition.create({
      ...records(formula()),
      relations: {
        owner: {
          tableId: targetId,
          linkFieldId: linkId,
          filter: {
            type: 'formula',
            formula: 'NOT(LOWER({title}) = BLANK())',
            references: {
              title: { type: 'field', fieldId: titleId },
              unused: { type: 'field', fieldId: declaredId },
            },
          },
        },
      },
    })._unsafeUnwrap();
    const usages = collectDataQuerySourceFieldUsages(definition.snapshot());
    expect(usages.get('root')?.get(declaredId)).toEqual(new Set(['projection', 'reference']));
    expect(usages.get('owner')?.get(declaredId)).toEqual(new Set(['filter', 'reference']));
    expect(usages.get('root')?.get(linkId)).toEqual(new Set(['relation']));
    const dependencies = collectDataQueryManifestDependencies(manifestOf());
    expect(dependencies.queries[0]).toMatchObject({
      complete: true,
      fields: [
        { fieldId: titleId, usages: ['projection', 'reference'] },
        { fieldId: declaredId, usages: ['projection', 'reference'] },
      ],
    });
  });

  it.each([
    { type: 'literal', value: 1 },
    { type: 'formula', formula: '1', references: {} },
    { type: 'field', fieldId: 'invalid-field-id' },
    { type: 'field', fieldId: titleId, injected: true },
  ])('rejects non-reference or open reference shapes: %j', (reference) => {
    expect(
      DataQueryDefinition.create(
        records({
          type: 'formula',
          formula: '1',
          references: { unused: reference },
        } as unknown as DataQueryFormulaExpression)
      ).isErr()
    ).toBe(true);
  });

  it('admits formula source structurally and applies the execution context budget during binding', async () => {
    const service = serviceFor(tableDto);
    const budgetContext = {
      ...context,
      config: { formulaSourceBudget: { astDepth: 64, visitedNodes: 32768, policyVersion: 1 } },
    };
    const nested = `${'LOWER('.repeat(65)}"text"${')'.repeat(65)}`;
    for (const [source, expectedCode] of [
      [nested, 'validation.limit.formula_compile_depth_max'],
      [
        `CONCATENATE(${Array.from({ length: 32769 }, () => '"a"').join(',')})`,
        'validation.limit.formula_compile_nodes_max',
      ],
      [`${'IF(1, 1, '.repeat(65)}1${')'.repeat(65)}`, 'validation.limit.formula_compile_depth_max'],
    ] as const) {
      const raw = records({ type: 'formula', formula: source, references: {} });
      expect(executeDataQueryRequestSchema.safeParse({ definition: raw }).success).toBe(true);
      expect(validateDataQueryRequestSchema.safeParse({ definition: raw }).success).toBe(true);
      expect(
        dataQueryManifestSchema.safeParse({
          schemaVersion: 1,
          queries: { bounded: { definition: raw } },
        }).success
      ).toBe(true);
      const definition = DataQueryDefinition.create(raw)._unsafeUnwrap();
      expect((await service.validate(budgetContext, definition))._unsafeUnwrapErr().code).toBe(
        expectedCode
      );
    }
    const definition = DataQueryDefinition.create(
      records({ type: 'formula', formula: nested, references: {} })
    )._unsafeUnwrap();
    expect(
      (
        await service.validate(
          {
            ...context,
            config: {
              formulaSourceBudget: { astDepth: 512, visitedNodes: 32768, policyVersion: 1 },
            },
          },
          definition
        )
      ).isOk()
    ).toBe(true);
  });

  it('does not accept a missing live field merely because its declared reference is unused', () => {
    const definition = DataQueryDefinition.create(
      records({
        type: 'formula',
        formula: '1',
        references: { unused: { type: 'field', fieldId: missingId } },
      })
    )._unsafeUnwrap();
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    expect(DataQueryBinding.prepare(definition, table)._unsafeUnwrapErr().code).toBe(
      'data_query.field_missing'
    );
  });

  it('rejects formula placeholders that have no declared reference', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    const binding = DataQueryDefinition.create(
      records({
        type: 'formula',
        formula: 'LOWER({undeclared})',
        references: { title: { type: 'field', fieldId: titleId } },
      })
    ).andThen((definition) => DataQueryBinding.prepare(definition, table));
    expect(binding.isErr()).toBe(true);
  });

  it('rewrites unused reference leaves without rewriting formula text or reference aliases', () => {
    const manifest = manifestOf();
    const plan = planDataQueryManifestRepair(
      manifest,
      {
        kind: 'field_replaced',
        tableId,
        fieldId: declaredId,
        replacementFieldId: replacementId,
        outputCompatible: true,
      },
      collectDataQueryManifestDependencies(manifest).queries
    );
    expect(plan.applyable).toBe(true);
    expect(plan.repaired?.queries.captions.definition).toMatchObject({
      select: [
        {
          expr: {
            type: 'formula',
            formula: 'LOWER({title})',
            references: {
              title: { type: 'field', fieldId: titleId },
              declared: { type: 'field', fieldId: replacementId },
            },
          },
        },
      ],
    });
    expect(
      parseDataQueryManifestText(serializeDataQueryManifest(plan.repaired!))._unsafeUnwrap()
    ).toEqual(plan.repaired);
    const deletion = planDataQueryManifestRepair(
      manifest,
      { kind: 'field_deleted', tableId, fieldId: declaredId },
      collectDataQueryManifestDependencies(manifest).queries
    );
    expect(deletion.queries[0]).toMatchObject({
      classification: 'manual',
      reasons: ['expression_semantics_changed'],
      actions: [],
    });
    expect(deletion.applyable).toBe(false);
  });

  it('generates live formula output types while keeping offline output types unknown', () => {
    const manifest = manifestOf();
    const definition = DataQueryDefinition.create(
      manifest.queries.captions.definition
    )._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(
      definition,
      mapper.toDomain(tableDto())._unsafeUnwrap()
    )._unsafeUnwrap();
    expect(binding.plan).toMatchObject({ definitionVersion: 3, formulaLanguage: 'teable-formula' });
    expect(binding.outputs[0]).toMatchObject({
      alias: 'caption',
      wireType: 'string',
      cellValueType: 'string',
      isMultipleCellValue: false,
    });
    const offline = generateAppQueryArtifacts(manifest)._unsafeUnwrap();
    const live = generateAppQueryArtifacts(manifest, {
      captions: { outputs: binding.outputs },
    })._unsafeUnwrap();
    const files: Record<string, string> = {
      '/formula-types/offline.ts': offline.module,
      '/formula-types/live.ts': live.module,
      '/formula-types/request.ts':
        'export declare function request<T>(path:string, options:unknown):Promise<T>; export declare function getConfig(): {baseId:string};',
      '/formula-types/server-only.d.ts': "declare module 'server-only';",
      '/formula-types/consumer.ts': `import {queries as offlineQueries, QueryRows as OfflineRows} from './offline';
import {queries as liveQueries, QueryRows as LiveRows} from './live';
const offlineText: OfflineRows['captions'] = {caption: 'title'};
const offlineNumber: OfflineRows['captions'] = {caption: 42};
const offlineNull: OfflineRows['captions'] = {caption: null};
const liveText: LiveRows['captions'] = {caption: 'title'};
// @ts-expect-error live formula output is text, not numeric
const liveNumber: LiveRows['captions'] = {caption: 42};
async function consume() {
  const offlineRows = await offlineQueries.captions();
  const offlineCaption: unknown = offlineRows[0]!.caption;
  // @ts-expect-error offline output stays unknown until live metadata is available
  const unsafeCaption: string | null = offlineRows[0]!.caption;
  const liveRows = await liveQueries.captions();
  const liveCaption: string | null = liveRows[0]!.caption;
  // @ts-expect-error live output cannot be consumed as a number
  const numericCaption: number | null = liveRows[0]!.caption;
  void offlineCaption; void unsafeCaption; void liveCaption; void numericCaption;
}
void offlineText; void offlineNumber; void offlineNull; void liveText; void liveNumber; void consume;`,
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
      path === '/formula-types' || Boolean(originalDirectoryExists?.(path));
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

  it('keeps declared formula parameters out of literal combinatorial warnings', () => {
    const queries = Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [
        `variant${index}`,
        {
          definition: {
            ...records({
              type: 'formula',
              formula: 'LOWER({title})',
              references: {
                title: { type: 'field', fieldId: titleId },
                unused: { type: 'parameter', name: 'label' },
              },
            }),
            parameters: { label: { type: 'string' } },
            page: { limit: index + 1 },
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

  it('includes unused declared reference semantics in signatures but excludes unrelated fields', async () => {
    let dto = tableDto();
    const service = serviceFor(() => dto);
    const definition = DataQueryDefinition.create(records(formula()))._unsafeUnwrap();
    const signature = async () =>
      (
        await service.validate(context, definition, { includeSchemaSignature: true })
      )._unsafeUnwrap().schemaSignature;
    const baseline = await signature();
    dto = {
      ...tableDto(),
      fields: tableDto().fields.map((field) =>
        field.id === unrelatedId
          ? {
              id: field.id,
              name: field.name,
              dbFieldName: field.dbFieldName,
              type: 'longText' as const,
            }
          : field
      ),
    };
    expect(await signature()).toBe(baseline);
    dto = {
      ...tableDto(),
      fields: tableDto().fields.map((field) =>
        field.id === declaredId
          ? {
              id: field.id,
              name: field.name,
              dbFieldName: field.dbFieldName,
              type: 'longText' as const,
            }
          : field
      ),
    };
    expect(await signature()).not.toBe(baseline);
  });

  it.each([false, true])(
    'authorizes unused formula references before live binding diagnostics (relations=%s)',
    async (relations) => {
      const root = mapper.toDomain(tableDto())._unsafeUnwrap();
      const target = mapper.toDomain(tableDto(targetId))._unsafeUnwrap();
      let denied = true;
      const plugins = new RecordQueryPluginRunner(
        [
          {
            name: 'formula-read-scope',
            supports: () => true,
            scope: () => ok(denied ? { readableFieldIds: new Set([titleId, linkId]) } : {}),
          },
        ],
        new NoopLogger()
      );
      let loads = 0;
      const repository = {
        findOne: async () => ok(relations && loads++ % 2 === 1 ? target : root),
      };
      const execute = vi.fn(async () => ok({ rows: [] }));
      const executeRelation = vi.fn(async () => ok({ rows: [] }));
      const explain = vi.fn(async () => {
        throw new Error('Invalid formula must not reach an explainer');
      });
      const explainRelation = vi.fn(async () => {
        throw new Error('Invalid formula must not reach a relation explainer');
      });
      const service = new DataQueryService(repository, plugins, { execute, executeRelation });
      const explainService = new DataQueryExplainService(repository, plugins, {
        explain,
        explainRelation,
      });
      const definition = DataQueryDefinition.create({
        ...records({
          type: 'formula',
          formula: 'LOWER({title})',
          references: {
            title: { type: 'field', fieldId: titleId },
            unused: {
              type: 'field',
              fieldId: missingId,
              ...(relations ? { source: 'owner' } : {}),
            },
          },
        }),
        ...(relations ? { relations: { owner: { tableId: targetId, linkFieldId: linkId } } } : {}),
      })._unsafeUnwrap();
      for (const operation of [
        () => service.validate(context, definition),
        () => service.execute(context, definition),
        () => explainService.explain(context, definition),
      ]) {
        denied = true;
        expect((await operation())._unsafeUnwrapErr().code).toBe('data_query.field_forbidden');
        denied = false;
        expect((await operation())._unsafeUnwrapErr().code).toBe('data_query.field_missing');
      }
      expect(execute).not.toHaveBeenCalled();
      expect(executeRelation).not.toHaveBeenCalled();
      expect(explain).not.toHaveBeenCalled();
      expect(explainRelation).not.toHaveBeenCalled();
    }
  );
});
