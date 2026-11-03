import {
  OperationPreviewService,
  createCorePreviewPlannerRegistry,
  v2CommandExplainTokens,
} from '@teable/v2-command-explain';
import {
  ActorId,
  BaseId,
  DefaultTableMapper,
  FieldDeletionPreparationService,
  FieldDeletionSideEffectService,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
  ok,
  v2CoreTokens,
  type IExecutionContext,
  type ITableRepository,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { describe, expect, it, vi } from 'vitest';

import { V2DeletePreviewResourceAuthorizationRegistrar } from './v2-delete-preview-resource-authorization';

const id = (prefix: 'bse' | 'tbl' | 'fld', seed: string) => `${prefix}${seed.repeat(16)}`;
const baseId = BaseId.create(id('bse', 'a'))._unsafeUnwrap();
const context: IExecutionContext = {
  actorId: ActorId.create('usr_preview_names')._unsafeUnwrap(),
};

type FieldDeleteFixture = {
  readonly table: Table;
  readonly targetId: FieldId;
};

type PreviewRuntime = {
  readonly allowedActions: Map<string, Set<string>>;
  readonly dependencyTable: Table;
  readonly fieldFixture: FieldDeleteFixture;
  readonly service: OperationPreviewService;
};

const buildFieldDeleteTable = () => {
  const tableId = TableId.create(id('tbl', 'h'))._unsafeUnwrap();
  const primaryId = FieldId.create(id('fld', 'p'))._unsafeUnwrap();
  const targetId = FieldId.create(id('fld', 't'))._unsafeUnwrap();
  const dependentId = FieldId.create(id('fld', 'd'))._unsafeUnwrap();
  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Host table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryId)
    .withName(FieldName.create('Primary label')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(targetId)
    .withName(FieldName.create('Amount to remove')._unsafeUnwrap())
    .done();
  builder
    .field()
    .formula()
    .withId(dependentId)
    .withName(FieldName.create('Calculated total')._unsafeUnwrap())
    .withExpression(FormulaExpression.create(`{${targetId.toString()}}`)._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return { table: builder.build()._unsafeUnwrap(), targetId };
};

const buildDependencyTable = () => {
  const builder = Table.builder()
    .withId(TableId.create(id('tbl', 'x'))._unsafeUnwrap())
    .withBaseId(baseId)
    .withName(TableName.create('Private dependency table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(id('fld', 'x'))._unsafeUnwrap())
    .withName(FieldName.create('Private dependency field')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createRuntime = () => {
  const fieldFixture = buildFieldDeleteTable();
  const dependencyTable = buildDependencyTable();
  const tables = [fieldFixture.table, dependencyTable];
  const tableRepository = {
    findOne: vi.fn(
      async (_context: IExecutionContext, spec: Parameters<ITableRepository['findOne']>[1]) =>
        ok(tables.find((table) => spec.isSatisfiedBy(table))!)
    ),
    find: vi.fn(async () => ok(tables)),
  } as unknown as ITableRepository;
  const tableQueryService = {
    getById: vi.fn(async (_context: IExecutionContext, tableId: TableId) =>
      ok(tables.find((table) => table.id().equals(tableId))!)
    ),
  };
  const tableDeletionPreparation = {
    prepare: vi.fn(async () =>
      ok({
        table: fieldFixture.table,
        mode: 'soft' as const,
        sourceState: 'active' as const,
        blockers: [],
        sideEffects: {
          deletedTable: fieldFixture.table,
          candidateEvidence: 'known' as const,
          candidateTableCount: 1,
          downstreamCascadeEvidence: 'known' as const,
          candidatePlans: [],
          reactionEffects: [
            {
              tableId: dependencyTable.id().toString(),
              tableName: dependencyTable.name().toString(),
              fieldId: dependencyTable.getFields()[0]!.id().toString(),
              fieldName: dependencyTable.getFields()[0]!.name().toString(),
              previousType: 'link',
              nextType: 'singleLineText',
              consequence: 'inbound-link-converted-to-text' as const,
            },
            {
              tableId: dependencyTable.id().toString(),
              tableName: dependencyTable.name().toString(),
              fieldId: id('fld', 'z'),
              fieldName: 'Unknown dependency field',
              previousType: 'lookup',
              nextType: 'lookup',
              consequence: 'dependent-field-marked-error' as const,
            },
          ],
        },
      })
    ),
  };
  const allowedActions = new Map<string, Set<string>>();
  const permissionService = {
    validPermissions: vi.fn(async (tableId: string, actions: string[]) => {
      const allowed = allowedActions.get(tableId) ?? new Set<string>();
      if (!actions.every((action) => allowed.has(action))) throw new Error('denied');
      return actions;
    }),
  };
  const dependencies = new Map<unknown, unknown>([
    [v2CoreTokens.tableRepository, tableRepository],
    [v2CoreTokens.tableMapper, {}],
    [v2CoreTokens.tableQueryService, tableQueryService],
    [v2CoreTokens.tableRecordQueryRepository, {}],
    [v2CoreTokens.foreignTableLoaderService, { load: async () => ok([]) }],
    [
      v2CoreTokens.fieldDeletionSideEffectService,
      { prepare: FieldDeletionSideEffectService.prepare },
    ],
    [v2CoreTokens.tableDeletionPreparationService, tableDeletionPreparation],
    [v2CoreTokens.recordWriteSideEffectService, {}],
    [v2CoreTokens.deleteByRangeApplicationService, {}],
    [v2CoreTokens.fieldConversionPreparationService, {}],
    [
      v2CoreTokens.fieldDeletionPreparationService,
      new FieldDeletionPreparationService(
        tableRepository,
        { load: async () => ok([]) },
        { prepare: FieldDeletionSideEffectService.prepare },
        new DefaultTableMapper()
      ),
    ],
    [v2CoreTokens.pastePreparationService, {}],
    [v2CoreTokens.bulkRecordPreparationService, {}],
    [v2CoreTokens.duplicateTablePreparationService, {}],
  ]);
  const container = {
    resolve(token: unknown) {
      if (!dependencies.has(token)) throw new Error(`Unexpected dependency: ${String(token)}`);
      return dependencies.get(token);
    },
  } as unknown as DependencyContainer;
  const registry = createCorePreviewPlannerRegistry(container);
  dependencies.set(v2CommandExplainTokens.previewPlannerRegistry, registry);
  const service = new OperationPreviewService(registry);
  const registrar = new V2DeletePreviewResourceAuthorizationRegistrar(
    permissionService as never,
    { get: vi.fn().mockReturnValue(undefined) } as never
  );
  registrar.registerProjections(container);
  return { allowedActions, dependencyTable, fieldFixture, service };
};

const allow = (runtime: PreviewRuntime, table: Table, actions: string[]) => {
  runtime.allowedActions.set(table.id().toString(), new Set(actions));
};

describe('V2DeletePreviewResourceAuthorizationRegistrar', () => {
  it('preserves authorized field, view, and table names through the live registry seam', async () => {
    const runtime = createRuntime();
    allow(runtime, runtime.fieldFixture.table, ['table|read', 'field|read']);

    const deniedView = await runtime.service.preview(context, {
      operation: 'field.delete',
      input: {
        baseId: baseId.toString(),
        tableId: runtime.fieldFixture.table.id().toString(),
        fieldId: runtime.fieldFixture.targetId.toString(),
      },
      options: { detail: 'full' },
    });
    const deniedViewJson = JSON.stringify(deniedView._unsafeUnwrap());
    expect(deniedViewJson).toContain('Amount to remove');
    expect(deniedViewJson).toContain('Host table');
    expect(deniedViewJson).not.toContain(runtime.fieldFixture.table.views()[0]!.name().toString());

    allow(runtime, runtime.fieldFixture.table, ['table|read', 'field|read', 'view|read']);
    const authorizedView = await runtime.service.preview(context, {
      operation: 'field.delete',
      input: {
        baseId: baseId.toString(),
        tableId: runtime.fieldFixture.table.id().toString(),
        fieldId: runtime.fieldFixture.targetId.toString(),
      },
      options: { detail: 'full' },
    });
    expect(JSON.stringify(authorizedView._unsafeUnwrap())).toContain(
      runtime.fieldFixture.table.views()[0]!.name().toString()
    );
  });

  it('redacts a denied dependency despite admitted target access, then reveals it when allowed', async () => {
    const runtime = createRuntime();
    allow(runtime, runtime.fieldFixture.table, ['table|read']);

    const denied = await runtime.service.preview(context, {
      operation: 'table.delete',
      input: {
        baseId: baseId.toString(),
        tableId: runtime.fieldFixture.table.id().toString(),
        mode: 'soft',
      },
      options: { detail: 'full' },
    });
    const deniedJson = JSON.stringify(denied._unsafeUnwrap());
    expect(deniedJson).toContain('Host table');
    expect(deniedJson).not.toContain('Private dependency table');
    expect(deniedJson).not.toContain('Private dependency field');
    expect(denied._unsafeUnwrap().effects[1]).toMatchObject({
      code: 'table.delete.dependent_resources.redacted',
      resource: { visibility: 'redacted' },
    });
    expect(denied._unsafeUnwrap().effects[1]?.relatedResources).toBeUndefined();

    allow(runtime, runtime.dependencyTable, ['table|read', 'field|read']);
    const authorized = await runtime.service.preview(context, {
      operation: 'table.delete',
      input: {
        baseId: baseId.toString(),
        tableId: runtime.fieldFixture.table.id().toString(),
        mode: 'soft',
      },
      options: { detail: 'full' },
    });
    const authorizedJson = JSON.stringify(authorized._unsafeUnwrap());
    expect(authorizedJson).toContain('Private dependency table');
    expect(authorizedJson).toContain('Private dependency field');
    expect(authorizedJson).not.toContain('Unknown dependency field');
    expect(authorized._unsafeUnwrap().effects[2]?.resource).toMatchObject({
      visibility: 'redacted',
    });
  });
});
