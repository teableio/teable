import { HttpException, HttpStatus } from '@nestjs/common';
import {
  createFieldConvertPreviewRegistration,
  FieldConvertPreviewPlanner,
  isPreviewOperation,
  OperationPreviewService,
  PreviewPlannerRegistry,
  v2CommandExplainTokens,
  type IOperationPreviewService,
  type OperationPreview,
} from '@teable/v2-command-explain';
import {
  ActorId,
  BaseId,
  DefaultTableMapper,
  domainError,
  FieldConversionPreparationService,
  FieldId,
  FieldName,
  ForeignTableLoaderService,
  MemoryTableRepository,
  Table,
  TableId,
  TableName,
  v2CoreTokens,
  type IExecutionContext,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  type IV2OperationPreviewAuthorization,
  V2_OPERATION_PREVIEW_AUTHORIZATION,
} from './v2-operation-preview-authorization';
import { V2Controller } from './v2.controller';

const context: IExecutionContext = {
  actorId: ActorId.create('usrPreview')._unsafeUnwrap(),
};

const metadata = {
  observedAt: '2026-10-27T10:00:00.000Z',
  consistency: 'best-effort' as const,
  requestDigest: `sha256:${'a'.repeat(64)}`,
};

const tableDeletePreview: OperationPreview = {
  operation: 'table.delete',
  outcome: 'incomplete',
  effects: [
    {
      code: 'table.delete.dependent_resources.redacted',
      kind: 'dependency.change',
      resource: {
        visibility: 'redacted',
        kind: 'field',
        quantity: { basis: 'unknown', unit: 'field', reason: 'dependent-resource-redacted' },
        reason: 'dependent-resource-redacted',
      },
      measures: { fields: { basis: 'unknown', unit: 'field', reason: 'resource-redacted' } },
    },
  ],
  blockers: [],
  warnings: [{ code: 'table.delete.authorization_scope_unavailable' }],
  coverage: { known: ['target-table'], unknown: ['dependent-resource-authorization'] },
  complexity: null,
  authorization: 'not-applicable',
  ...metadata,
  implementation: { plannerVersion: 'table-delete-v1', executionPath: 'DeleteTableCommand' },
};

const tableDuplicatePreview: OperationPreview = {
  operation: 'table.duplicate',
  outcome: 'blocked',
  effects: [],
  blockers: [{ code: 'table.duplicate.cross_space_reference_blocked' }],
  warnings: [],
  coverage: { known: ['host.cross-space-reference-policy'], unknown: [] },
  complexity: null,
  authorization: 'checked',
  ...metadata,
  implementation: {
    plannerVersion: 'table-duplicate-host-v1',
    executionPath: 'DuplicateTableCommand/DuplicateTablePreparationService',
  },
};

const baseDuplicatePreview: OperationPreview = {
  operation: 'base.duplicate',
  outcome: 'blocked',
  effects: [],
  blockers: [{ code: 'base.duplicate.host_checks.blocked' }],
  warnings: [],
  coverage: { known: ['host.authorization', 'host.migration-guard'], unknown: [] },
  complexity: null,
  authorization: 'checked',
  ...metadata,
  implementation: {
    plannerVersion: 'base-duplicate-host-ce-v1',
    executionPath: 'BaseDuplicateService.prepareDuplicateBaseV2',
  },
};

const buildPreviewTable = (suffix = 'p') => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${suffix.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${suffix.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Preview authorization')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(`fld${suffix.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createController = (
  preview: OperationPreview,
  authorization?: IV2OperationPreviewAuthorization
) => {
  const service = {
    preview: vi.fn().mockResolvedValue(ok(preview)),
  } as unknown as IOperationPreviewService;
  const unsupportedRegistry = PreviewPlannerRegistry.empty();
  const registry = {
    resolve: vi.fn((operation: string) =>
      isPreviewOperation(operation) ? ok({}) : unsupportedRegistry.resolve(operation)
    ),
  } as unknown as PreviewPlannerRegistry;
  const table = buildPreviewTable();
  const tableQueryService = { getById: vi.fn().mockResolvedValue(ok(table)) };
  const resolve = vi.fn((token: symbol) => {
    if (token === v2CommandExplainTokens.operationPreviewService) return service;
    if (token === v2CommandExplainTokens.previewPlannerRegistry) return registry;
    if (token === V2_OPERATION_PREVIEW_AUTHORIZATION && authorization) return authorization;
    if (token === v2CoreTokens.tableQueryService) return tableQueryService;
    throw new Error(`Write or unexpected dependency resolved: ${String(token)}`);
  });
  const isRegistered = vi.fn(
    (token: symbol) => token === V2_OPERATION_PREVIEW_AUTHORIZATION && authorization != null
  );
  const tableContainer = { resolve, isRegistered };
  const baseContainer = { resolve, isRegistered };
  const defaultContainer = { resolve, isRegistered };
  const v2Container = {
    getContainerForTable: vi.fn().mockResolvedValue(tableContainer),
    getPreviewContainerForTable: vi.fn().mockResolvedValue(tableContainer),
    getContainerForBase: vi.fn().mockResolvedValue(baseContainer),
    getContainer: vi.fn().mockResolvedValue(defaultContainer),
  };
  const v2ContextFactory = { createContext: vi.fn().mockResolvedValue(context) };
  const permissionService = { validPermissions: vi.fn().mockResolvedValue(undefined) };
  const cls = {
    get: vi.fn((key: string) => (key === 'accessTokenId' ? 'patPreview' : undefined)),
  };
  const controller = new V2Controller(
    v2Container as never,
    v2ContextFactory as never,
    permissionService as never,
    cls as never,
    {} as never
  );
  return {
    controller,
    service,
    registry,
    resolve,
    v2Container,
    v2ContextFactory,
    permissionService,
    table,
    tableQueryService,
  };
};

describe('V2Controller operation preview', () => {
  it('uses table-delete authorization and preserves redacted incomplete output', async () => {
    const fixture = createController(tableDeletePreview);
    const request = {
      operation: 'table.delete' as const,
      input: { baseId: 'bseA', tableId: 'tblDelete' },
    };

    const result = await fixture.controller.operationPreview().callable()(request);

    expect(result).toEqual({ ok: true, data: tableDeletePreview });
    expect(result.data.effects[0]?.resource?.visibility).toBe('redacted');
    expect(fixture.permissionService.validPermissions).toHaveBeenCalledWith(
      'tblDelete',
      ['table|delete'],
      'patPreview'
    );
    expect(fixture.v2Container.getPreviewContainerForTable).toHaveBeenCalledWith('tblDelete');
    expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.v2ContextFactory.createContext).toHaveBeenCalledWith(
      await fixture.v2Container.getPreviewContainerForTable.mock.results[0]?.value
    );
    expect(fixture.resolve).not.toHaveBeenCalledWith(v2CoreTokens.commandBus);
    expect(fixture.service.preview).toHaveBeenCalledOnce();
    expect(fixture.resolve).toHaveBeenCalledTimes(2);
  });

  it('requires both write-route permissions for table duplication before planning', async () => {
    const fixture = createController(tableDuplicatePreview);
    fixture.permissionService.validPermissions.mockRejectedValue(
      new HttpException('Forbidden', HttpStatus.FORBIDDEN)
    );

    await expect(
      fixture.controller.operationPreview().callable()({
        operation: 'table.duplicate',
        input: { baseId: 'bseA', tableId: 'tblDuplicate', name: 'Copy' },
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      data: { domainCode: 'preview.authorization.forbidden' },
    });

    expect(fixture.permissionService.validPermissions).toHaveBeenCalledWith(
      'tblDuplicate',
      ['table|create', 'table|read'],
      'patPreview'
    );
    expect(fixture.service.preview).not.toHaveBeenCalled();
    expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
  });

  it('maps preview authentication failures to a stable unauthorized DTO', async () => {
    const fixture = createController(tableDeletePreview);
    fixture.permissionService.validPermissions.mockRejectedValue(
      new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED)
    );

    await expect(
      fixture.controller.operationPreview().callable()({
        operation: 'records.bulkDelete',
        input: { tableId: 'tblRestricted', recordIds: ['recHidden'] },
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      data: { domainCode: 'preview.authorization.unauthorized' },
    });

    expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
    expect(fixture.service.preview).not.toHaveBeenCalled();
  });

  it('normalizes missing and hidden table admission to the same public denial', async () => {
    const hidden = createController(tableDeletePreview);
    hidden.permissionService.validPermissions.mockRejectedValue(
      new HttpException('Forbidden', HttpStatus.FORBIDDEN)
    );
    const missing = createController(tableDeletePreview);
    missing.permissionService.validPermissions.mockRejectedValue(
      new HttpException('Not found', HttpStatus.NOT_FOUND)
    );
    const request = {
      operation: 'table.delete' as const,
      input: { baseId: 'bseA', tableId: 'tblPrivate' },
    };

    const [hiddenError, missingError] = await Promise.all([
      hidden.controller
        .operationPreview()
        .callable()(request)
        .catch((error) => error),
      missing.controller
        .operationPreview()
        .callable()(request)
        .catch((error) => error),
    ]);

    expect(hiddenError).toMatchObject({
      code: 'FORBIDDEN',
      data: { domainCode: 'preview.authorization.forbidden' },
    });
    expect(missingError).toEqual(hiddenError);
    expect(hidden.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(missing.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(hidden.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
    expect(missing.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
  });

  it.each(['options', 'config'] as const)(
    'returns identical opaque denials for hidden and missing foreign %s references before planning',
    async (referenceKey) => {
      const failures = [];
      for (const [suffix, status] of [
        ['h', HttpStatus.FORBIDDEN],
        ['m', HttpStatus.NOT_FOUND],
      ] as const) {
        const fixture = createController(tableDeletePreview);
        const foreignTableId = `tbl${suffix.repeat(16)}`;
        fixture.permissionService.validPermissions.mockImplementation(async (resourceId) => {
          if (resourceId === foreignTableId) {
            throw new HttpException(`Foreign resource ${foreignTableId}`, status);
          }
        });
        const failure = await fixture.controller
          .operationPreview()
          .callable()({
            operation: 'field.convert',
            input: {
              tableId: fixture.table.id().toString(),
              fieldId: fixture.table.getFields()[0]!.id().toString(),
              field: { type: 'singleLineText', [referenceKey]: { foreignTableId } },
            },
          })
          .catch((error) => error);

        expect(failure).toMatchObject({
          code: 'FORBIDDEN',
          message: 'You do not have permission to preview this operation.',
          data: { domainCode: 'preview.authorization.forbidden', details: undefined },
        });
        expect(JSON.stringify(failure)).not.toContain(foreignTableId);
        expect(fixture.service.preview).not.toHaveBeenCalled();
        expect(fixture.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
        failures.push(failure);
      }
      expect(failures[0]).toEqual(failures[1]);
    }
  );

  it('preserves an authorized foreign reference no-op through the real conversion planner', async () => {
    const fixture = createController(tableDeletePreview);
    const foreignTable = buildPreviewTable('a');
    const repository = new MemoryTableRepository();
    (await repository.insert(context, fixture.table))._unsafeUnwrap();
    (await repository.insert(context, foreignTable))._unsafeUnwrap();
    const loader = new ForeignTableLoaderService(repository);
    const preparation = new FieldConversionPreparationService(
      repository,
      new DefaultTableMapper(),
      loader
    );
    const registry = PreviewPlannerRegistry.create([
      createFieldConvertPreviewRegistration(
        new FieldConvertPreviewPlanner(preparation, { aggregate: async () => ok([]) })
      ),
    ])._unsafeUnwrap();
    const service = new OperationPreviewService(registry);
    vi.mocked(fixture.service.preview).mockImplementation((executionContext, request) =>
      service.preview(executionContext, request)
    );

    const result = await fixture.controller.operationPreview().callable()({
      operation: 'field.convert',
      input: {
        tableId: fixture.table.id().toString(),
        fieldId: fixture.table.getFields()[0]!.id().toString(),
        field: {
          type: 'singleLineText',
          options: { foreignTableId: foreignTable.id().toString() },
        },
      },
      options: { includeComplexity: false },
    });

    expect(result.data.effects).toEqual([
      {
        code: 'field.conversion.noop',
        kind: 'field.conversion',
        measures: { changedFields: { basis: 'exact', value: 0, unit: 'fields' } },
      },
    ]);
    expect(fixture.permissionService.validPermissions).toHaveBeenCalledWith(
      foreignTable.id().toString(),
      ['record|read'],
      'patPreview'
    );
  });

  it('returns a stable forbidden DTO and does not resolve a planner after host denial', async () => {
    const authorization = {
      authorize: vi.fn().mockResolvedValue(
        err(
          domainError.forbidden({
            code: 'authority_matrix.preview_scope_unsupported',
            message: 'A safe preview is unavailable for this restricted authority scope.',
          })
        )
      ),
    };
    const fixture = createController(tableDeletePreview, authorization);

    const error = await fixture.controller
      .operationPreview()
      .callable()({
        operation: 'records.bulkUpdate',
        input: {
          tableId: 'tblRestricted',
          recordIds: ['recHidden'],
          fields: { fldVisible: 'value' },
        },
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      data: { domainCode: 'authority_matrix.preview_scope_unsupported' },
    });
    expect(JSON.stringify(error)).not.toContain('recHidden');
    expect(authorization.authorize).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ operation: 'records.bulkUpdate' }),
      expect.anything()
    );
    expect(fixture.permissionService.validPermissions).not.toHaveBeenCalled();
    expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
    expect(fixture.service.preview).not.toHaveBeenCalled();
  });

  it('fails closed when an admitted table has no current cached read-only container', async () => {
    const fixture = createController(tableDeletePreview);
    fixture.v2Container.getPreviewContainerForTable.mockResolvedValue(null);

    await expect(
      fixture.controller.operationPreview().callable()({
        operation: 'table.delete',
        input: { baseId: 'bseA', tableId: 'tblDelete' },
      })
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      data: { domainCode: 'preview.routing.not_ready' },
    });

    expect(fixture.permissionService.validPermissions).toHaveBeenCalledOnce();
    expect(fixture.v2Container.getPreviewContainerForTable).toHaveBeenCalledWith('tblDelete');
    expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.service.preview).not.toHaveBeenCalled();
  });

  it('uses host admission instead of the community role check when it is registered', async () => {
    const authorization = { authorize: vi.fn().mockResolvedValue(ok(undefined)) };
    const fixture = createController(tableDeletePreview, authorization);
    const request = {
      operation: 'table.delete' as const,
      input: { baseId: 'bseA', tableId: 'tblDelete' },
    };

    const result = await fixture.controller.operationPreview().callable()(request);

    expect(result).toEqual({ ok: true, data: tableDeletePreview });
    expect(authorization.authorize).toHaveBeenCalledOnce();
    expect(fixture.permissionService.validPermissions).not.toHaveBeenCalled();
    expect(fixture.v2Container.getPreviewContainerForTable).toHaveBeenCalledWith('tblDelete');
    expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.service.preview).toHaveBeenCalledOnce();
  });

  it('rejects unsupported operations before authorization or caller-selected routing', async () => {
    const warmAuthorization = { authorize: vi.fn().mockResolvedValue(ok(undefined)) };
    const warm = createController(tableDeletePreview, warmAuthorization);
    const coldAuthorization = { authorize: vi.fn().mockResolvedValue(ok(undefined)) };
    const cold = createController(tableDeletePreview, coldAuthorization);
    cold.v2Container.getPreviewContainerForTable.mockResolvedValue(null);

    const [warmError, coldError] = await Promise.all([
      warm.controller
        .operationPreview()
        .callable()({
          operation: 'extension.unknown',
          input: { tableId: 'tblWarmKnown' },
        })
        .catch((error) => error),
      cold.controller
        .operationPreview()
        .callable()({
          operation: 'extension.unknown',
          input: { tableId: 'tblForeignLooking' },
        })
        .catch((error) => error),
    ]);

    expect(warmError).toMatchObject({
      code: 'BAD_REQUEST',
      data: { domainCode: 'preview.operation.unsupported' },
    });
    expect(coldError).toEqual(warmError);
    for (const [fixture, authorization] of [
      [warm, warmAuthorization],
      [cold, coldAuthorization],
    ] as const) {
      expect(fixture.registry.resolve).toHaveBeenCalledWith('extension.unknown');
      expect(authorization.authorize).not.toHaveBeenCalled();
      expect(fixture.permissionService.validPermissions).not.toHaveBeenCalled();
      expect(fixture.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
      expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
      expect(fixture.v2ContextFactory.createContext).not.toHaveBeenCalled();
      expect(fixture.service.preview).not.toHaveBeenCalled();
    }
  });

  it('keeps base duplication on the non-routing host container after admission', async () => {
    const fixture = createController(baseDuplicatePreview);
    const request = {
      operation: 'base.duplicate' as const,
      input: { fromBaseId: 'bseSource', spaceId: 'spcTarget', withRecords: true },
    };

    const result = await fixture.controller.operationPreview().callable()(request);

    expect(result).toEqual({ ok: true, data: baseDuplicatePreview });
    expect(fixture.v2Container.getContainerForBase).not.toHaveBeenCalled();
    expect(fixture.v2Container.getContainerForTable).not.toHaveBeenCalled();
    expect(fixture.v2Container.getPreviewContainerForTable).not.toHaveBeenCalled();
    expect(fixture.v2Container.getContainer).toHaveBeenCalledOnce();
    expect(fixture.permissionService.validPermissions).not.toHaveBeenCalled();
    expect(fixture.resolve).not.toHaveBeenCalledWith(v2CoreTokens.commandBus);
    expect(fixture.service.preview).toHaveBeenCalledWith(context, request);
    expect(fixture.resolve).toHaveBeenCalledTimes(2);
  });

  it('returns a table duplicate blocker without converting it to an empty ready preview', async () => {
    const fixture = createController(tableDuplicatePreview);

    const result = await fixture.controller.operationPreview().callable()({
      operation: 'table.duplicate',
      input: { baseId: 'bseA', tableId: 'tblDuplicate', name: 'Copy' },
    });

    expect(result.data.outcome).toBe('blocked');
    expect(result.data.blockers).toEqual([
      { code: 'table.duplicate.cross_space_reference_blocked' },
    ]);
    expect(fixture.service.preview).toHaveBeenCalledOnce();
  });

  it('resolves capabilities from the request-selected initialized container', async () => {
    const fixture = createController(tableDeletePreview);
    const registry = PreviewPlannerRegistry.empty();
    const capabilityContainer = {
      resolve: vi.fn((token: symbol) => {
        if (token === v2CommandExplainTokens.previewPlannerRegistry) return registry;
        throw new Error(`Unexpected dependency: ${String(token)}`);
      }),
    };
    fixture.v2Container.getContainer.mockResolvedValue(capabilityContainer);

    const result = await fixture.controller.operationPreviewCapabilities().callable()({});

    expect(result).toEqual({ ok: true, data: [] });
    expect(capabilityContainer.resolve).toHaveBeenCalledWith(
      v2CommandExplainTokens.previewPlannerRegistry
    );
    expect(fixture.service.preview).not.toHaveBeenCalled();
  });
});
