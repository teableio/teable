import { ForbiddenException } from '@nestjs/common';
import {
  FieldDeletePreviewPlanner,
  FieldConvertPreviewPlanner,
  createFieldDeletePreviewRegistration,
} from '@teable/v2-command-explain';
import {
  ActorId,
  DeleteFieldsCommand,
  DefaultTableMapper,
  FieldConversionPreparationService,
  FieldCrossTableUpdateSideEffectService,
  FieldDeletionPreparationService,
  FieldDeletionSideEffectService,
  ForeignTableLoaderService,
  MemoryTableRepository,
  type TableUpdateFlow,
  type DomainError,
  v2CoreTokens,
  domainError,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { IAuthConfig } from '../../configs/auth.config';
import { TeableJwtService } from '../auth/jwt/teable-jwt.service';
import { FieldOpenApiV2Service } from '../field/open-api/field-open-api-v2.service';
import type { V2ContainerService } from './v2-container.service';
import { V2DataQueryCandidateService } from './v2-data-query-candidate.service';
import type { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { V2_OPERATION_PREVIEW_AUTHORIZATION } from './v2-operation-preview-authorization';

const tableId = `tbl${'a'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const fieldId = `fld${'b'.repeat(16)}`;
const candidate = { operation: 'delete' as const, tableId, fieldIds: [fieldId] };
const context = { actorId: ActorId.create('editor')._unsafeUnwrap() };
const jwt = () =>
  new TeableJwtService({
    jwt: { secret: 'candidate-preview-test-secret', expiresIn: '1h' },
  } as IAuthConfig);

const setup = async (
  options: {
    tokenId?: string;
    sourceTokenDenied?: boolean;
    deniedForeignIds?: readonly string[];
    matrixDenied?: boolean;
    previewUnavailable?: boolean;
    foreignTablePresent?: boolean;
    authenticatedAppId?: string | null;
  } = {}
) => {
  const mapper = new DefaultTableMapper();
  const table = mapper
    .toDomain({
      id: tableId,
      baseId: `bse${'a'.repeat(16)}`,
      name: 'Candidate',
      primaryFieldId: titleId,
      dbTableName: 'base.candidate',
      fields: [
        { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
        { id: fieldId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
      ],
      views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
    })
    ._unsafeUnwrap();
  const memory = new MemoryTableRepository();
  (await memory.insert(context, table))._unsafeUnwrap();
  if (options.foreignTablePresent) {
    const target = mapper
      .toDomain({
        id: `tbl${'c'.repeat(16)}`,
        baseId: `bse${'a'.repeat(16)}`,
        name: 'Target',
        primaryFieldId: `fld${'c'.repeat(16)}`,
        dbTableName: 'base.target',
        fields: [
          {
            id: `fld${'c'.repeat(16)}`,
            name: 'Title',
            type: 'singleLineText',
            dbFieldName: 'title',
          },
        ],
        views: [{ id: `viw${'c'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      })
      ._unsafeUnwrap();
    (await memory.insert(context, target))._unsafeUnwrap();
  }
  const repository = {
    find: vi.fn(memory.find.bind(memory)),
    findOne: vi.fn(memory.findOne.bind(memory)),
  };
  const loader = new ForeignTableLoaderService(repository);
  const loadForeign = vi.spyOn(loader, 'load');
  const conversion = new FieldConversionPreparationService(repository, mapper, loader);
  const deletion = new FieldDeletionPreparationService(
    repository,
    loader,
    { prepare: FieldDeletionSideEffectService.prepare },
    mapper
  );
  const lifecycle = new Proxy({} as TableUpdateFlow, {
    get() {
      throw new Error('Write lifecycle must never be accessed');
    },
  });
  const readOnlyMemory = new Proxy(memory, {
    get(target, key) {
      if (key === 'find') return target.find.bind(target);
      if (key === 'findOne') return target.findOne.bind(target);
      throw new Error(`Unexpected persistence access: ${String(key)}`);
    },
  });
  const cascade = new FieldCrossTableUpdateSideEffectService(readOnlyMemory, lifecycle);
  const fields = Object.create(FieldOpenApiV2Service.prototype) as FieldOpenApiV2Service;
  const hiddenAcquisition = vi.fn(() => {
    throw new Error('Migration-capable field acquisition is forbidden');
  });
  for (const method of ['getFieldFromV2', 'listDomainFields', 'hydrateLookupFieldVo']) {
    Object.defineProperty(fields, method, { value: hiddenAcquisition });
  }
  Object.defineProperty(fields, 'fieldSupplementService', {
    value: { assertSameSpaceLinkTarget: vi.fn(async () => undefined) },
  });
  const authorize = vi.fn(async () =>
    options.matrixDenied
      ? err(
          domainError.forbidden({
            code: 'preview.authorization.forbidden',
            message: 'Preview access denied',
          })
        )
      : ok(undefined)
  );
  const authorizeForeignTables = vi.fn(
    async (_context: unknown, _tableIds: readonly string[]): Promise<Result<void, DomainError>> =>
      ok(undefined)
  );
  const reads = new Map<symbol, unknown>([
    [v2CoreTokens.tableRepository, repository],
    [v2CoreTokens.tableMapper, mapper],
    [v2CoreTokens.fieldConversionPreparationService, conversion],
    [v2CoreTokens.fieldDeletionPreparationService, deletion],
    [v2CoreTokens.foreignTableLoaderService, loader],
    [v2CoreTokens.fieldCrossTableUpdateSideEffectService, cascade],
    [V2_OPERATION_PREVIEW_AUTHORIZATION, { authorize, authorizeForeignTables }],
  ]);
  const container = {
    isRegistered: (token: symbol) =>
      token === V2_OPERATION_PREVIEW_AUTHORIZATION && options.matrixDenied !== undefined,
    resolve: (token: symbol) => {
      if (!reads.has(token)) throw new Error('Unexpected write/lifecycle collaborator');
      return reads.get(token);
    },
  };
  const getContainer = vi.fn(async () => (options.previewUnavailable ? null : container));
  const normalAcquisition = vi.fn(() => {
    throw new Error('Normal container acquisition is forbidden');
  });
  const validPermissions = vi.fn(
    async (resourceId: string, _actions: readonly string[], _tokenId?: string) => {
      if (options.deniedForeignIds?.includes(resourceId))
        throw new ForbiddenException('private target details');
      return [];
    }
  );
  const permissions = {
    validPermissions,
    getPermissionsByAccessToken: vi.fn(async () =>
      options.sourceTokenDenied ? [] : ['field|delete', 'field|update']
    ),
  };
  let store: Record<string, unknown> = {
    accessTokenId: options.tokenId,
    appId: options.authenticatedAppId === undefined ? 'app-one' : options.authenticatedAppId,
  };
  const cls = {
    get: (key?: string) => (key ? store[key] : store),
    runWith: vi.fn(async (next: Record<string, unknown>, callback: () => Promise<unknown>) => {
      const prior = store;
      store = next;
      try {
        return await callback();
      } finally {
        store = prior;
      }
    }),
  };
  const service = new V2DataQueryCandidateService(
    {
      getPreviewContainerForTable: getContainer,
      getContainer: normalAcquisition,
      getContainerForTable: normalAcquisition,
    } as unknown as V2ContainerService,
    { createContext: async () => context } as unknown as V2ExecutionContextFactory,
    fields,
    jwt(),
    permissions as never,
    cls as never
  );
  return {
    container: container as unknown as DependencyContainer,
    deletion,
    conversion,
    service,
    getContainer,
    table,
    repository,
    mapper,
    loadForeign,
    hiddenAcquisition,
    normalAcquisition,
    validPermissions,
    authorize,
    authorizeForeignTables,
    cls,
  };
};

describe('shared operation preview preparation', () => {
  const options = { detail: 'full' as const, includeComplexity: false, maxItems: 100 };

  it('renders canonical deletion effects and admits only the matching detached schema', async () => {
    const { service, container, deletion, table } = await setup();
    const command = DeleteFieldsCommand.create({
      baseId: table.baseId().toString(),
      tableId,
      fieldIds: [fieldId],
    })._unsafeUnwrap();
    const prepared = (
      await service.preparePreview(context, container, candidate, {})
    )._unsafeUnwrap();
    if (prepared.operation !== 'field.delete') throw new Error('Expected deletion preparation');
    const facts = prepared.facts._unsafeUnwrap();
    const planner = new FieldDeletePreviewPlanner(deletion, {
      canReadResource: async () => ok(true),
    });
    const plan = (
      await planner.previewPrepared(context, command, prepared.facts, options)
    )._unsafeUnwrap();
    expect(
      plan.effects
        .filter((effect) => effect.code === 'field.delete.target')
        .map((effect) => effect.resource)
    ).toEqual([{ visibility: 'authorized', kind: 'field', id: fieldId, name: 'Amount' }]);
    expect(prepared.projectedTables).toBe(facts.projectedTablesById);
    expect(
      prepared.projectedTables
        .get(tableId)
        ?.getFields()
        .map((field) => field.id().toString())
    ).toEqual([titleId]);
    expect(table.getFields().map((field) => field.id().toString())).toEqual([titleId, fieldId]);
    expect(
      service.signCandidate(
        candidate,
        { appId: 'app-one', accessToken: 'token' },
        prepared.projectedTables
      )
    ).toEqual(expect.any(String));
    expect(() =>
      service.signCandidate(
        candidate,
        { appId: 'app-one', accessToken: 'token' },
        new Map(prepared.projectedTables)
      )
    ).toThrow(ForbiddenException);
    const parsed = createFieldDeletePreviewRegistration(planner).parseInput({
      baseId: table.baseId().toString(),
      tableId,
      fieldId,
      fieldIds: [fieldId],
    });
    expect(parsed.isErr()).toBe(true);
  });

  it('keeps native partial conversion semantics without aggregation', async () => {
    const { service, container, conversion, table } = await setup();
    const native = {
      operation: 'convert' as const,
      inputFormat: 'field-v2' as const,
      tableId,
      fieldId,
      field: { name: 'Renamed amount' },
    };
    const prepared = (await service.preparePreview(context, container, native, {}))._unsafeUnwrap();
    if (prepared.operation !== 'field.convert') throw new Error('Expected conversion preparation');
    const planner = new FieldConvertPreviewPlanner(conversion, {
      aggregate: () => {
        throw new Error('Prepared facts must not aggregate');
      },
    } as never);
    const plan = planner.previewPrepared(prepared.facts)._unsafeUnwrap();
    const field = prepared.projectedTables
      .get(tableId)!
      .getFields()
      .find((value) => value.id().toString() === fieldId)!;
    expect(field.name().toString()).toBe('Renamed amount');
    expect(field.type().toString()).toBe('number');
    expect(
      table
        .getFields()
        .find((value) => value.id().toString() === fieldId)!
        .name()
        .toString()
    ).toBe('Amount');
    expect(plan.effects[0].code).toBe('field.conversion.metadata_change');
    expect(
      service.signCandidate(
        native,
        { appId: 'app-one', accessToken: 'token' },
        prepared.projectedTables
      )
    ).toEqual(expect.any(String));
  });

  it('reports unknown affected cells for a genuine rewrite without aggregation evidence', async () => {
    const { service, container, conversion } = await setup();
    const native = {
      operation: 'convert' as const,
      inputFormat: 'field-v2' as const,
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    };
    const prepared = (await service.preparePreview(context, container, native, {}))._unsafeUnwrap();
    if (prepared.operation !== 'field.convert') throw new Error('Expected conversion preparation');
    const planner = new FieldConvertPreviewPlanner(conversion, {
      aggregate: () => {
        throw new Error('Prepared facts must not aggregate');
      },
    } as never);
    const plan = planner.previewPrepared(prepared.facts)._unsafeUnwrap();
    expect(prepared.facts.requiresDataRewrite).toBe(true);
    expect(plan.effects).toContainEqual(
      expect.objectContaining({
        code: 'field.conversion.record_rewrite',
        measures: { affectedCells: expect.objectContaining({ basis: 'unknown', unit: 'cells' }) },
      })
    );
  });
  it.each([true, false])(
    'separates unreadable target evidence from reciprocal deletion admission (oneWay=%s)',
    async (isOneWay) => {
      const foreignId = `tbl${'z'.repeat(16)}`;
      const fixture = await setup({ deniedForeignIds: [foreignId] });
      const source = fixture.mapper
        .toDomain({
          id: tableId,
          baseId: `bse${'a'.repeat(16)}`,
          name: 'Source',
          primaryFieldId: titleId,
          dbTableName: 'base.candidate',
          fields: [
            { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
            {
              id: fieldId,
              name: 'Owner',
              type: 'link',
              dbFieldName: 'owner',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignId,
                lookupFieldId: `fld${'z'.repeat(16)}`,
                isOneWay,
                ...(isOneWay ? {} : { symmetricFieldId: `fld${'s'.repeat(16)}` }),
                fkHostTableName: 'base.candidate',
                selfKeyName: '__id',
                foreignKeyName: 'owner_fk',
              },
            },
          ],
          views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      fixture.repository.findOne.mockResolvedValue(ok(source));
      fixture.loadForeign.mockImplementation(async () => {
        throw new Error('Unreadable target metadata must not load');
      });
      const result = await fixture.service.preparePreview(
        context,
        fixture.container,
        candidate,
        {}
      );
      if (!isOneWay) {
        expect(result._unsafeUnwrapErr().code).toBe('preview.authorization.forbidden');
        return;
      }
      const prepared = result._unsafeUnwrap();
      if (prepared.operation !== 'field.delete') throw new Error('Expected deletion preparation');
      const facts = prepared.facts._unsafeUnwrap();
      const command = DeleteFieldsCommand.create({
        baseId: source.baseId().toString(),
        tableId,
        fieldIds: [fieldId],
      })._unsafeUnwrap();
      const planner = new FieldDeletePreviewPlanner(fixture.deletion, {
        canReadResource: async () => ok(true),
      });
      const plan = (
        await planner.previewPrepared(context, command, prepared.facts, options)
      )._unsafeUnwrap();
      expect(plan.blockers).toEqual([]);
      expect(plan.warnings).toContainEqual(
        expect.objectContaining({ code: 'field.delete.foreign_metadata_missing' })
      );
      expect(JSON.stringify(plan)).not.toContain(foreignId);
      expect(
        facts.projectedTable.getField((field) => field.id().toString() === fieldId).isErr()
      ).toBe(true);
      expect(source.getField((field) => field.id().toString() === fieldId).isOk()).toBe(true);
      expect(() =>
        fixture.service.signCandidate(
          candidate,
          { appId: 'app-one', accessToken: 'token' },
          prepared.projectedTables
        )
      ).toThrow(ForbiddenException);
    }
  );

  const computedForeignId = `tbl${'z'.repeat(16)}`;
  const computedValueId = `fld${'z'.repeat(16)}`;
  const sourceLinkId = `fld${'k'.repeat(16)}`;
  const linkedConfig = {
    foreignTableId: computedForeignId,
    lookupFieldId: computedValueId,
    linkFieldId: sourceLinkId,
  };
  const conditionalConfig = {
    foreignTableId: computedForeignId,
    lookupFieldId: computedValueId,
    condition: {
      filter: {
        conjunction: 'and' as const,
        filterSet: [{ fieldId: computedValueId, operator: 'is', value: 1 }],
      },
    },
  };
  it.each([
    {
      label: 'lookup',
      field: {
        type: 'number' as const,
        isLookup: true,
        lookupOptions: linkedConfig,
        options: { formatting: { type: 'decimal', precision: 0 } },
      },
    },
    {
      label: 'rollup',
      field: {
        type: 'rollup' as const,
        config: linkedConfig,
        options: { expression: 'sum({values})' },
      },
    },
    {
      label: 'conditional lookup',
      field: {
        type: 'conditionalLookup' as const,
        options: conditionalConfig,
        innerType: 'number' as const,
        innerOptions: { formatting: { type: 'decimal', precision: 0 } },
      },
    },
    {
      label: 'conditional rollup',
      field: {
        type: 'conditionalRollup' as const,
        config: conditionalConfig,
        options: { expression: 'sum({values})' },
      },
    },
  ])(
    'keeps source-only $label deletion advisory when foreign read access is lost',
    async ({ field }) => {
      const fixture = await setup({ deniedForeignIds: [computedForeignId] });
      const source = fixture.mapper
        .toDomain({
          id: tableId,
          baseId: `bse${'a'.repeat(16)}`,
          name: 'Source',
          primaryFieldId: titleId,
          dbTableName: 'base.candidate',
          fields: [
            { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
            {
              id: sourceLinkId,
              name: 'Source link',
              type: 'link',
              dbFieldName: 'owner',
              options: {
                relationship: 'manyOne',
                foreignTableId: computedForeignId,
                lookupFieldId: computedValueId,
                isOneWay: true,
                fkHostTableName: 'base.candidate',
                selfKeyName: '__id',
                foreignKeyName: 'owner_fk',
              },
            },
            {
              id: fieldId,
              name: 'Computed value',
              dbFieldName: 'computed_value',
              isComputed: true,
              cellValueType: 'number',
              isMultipleCellValue: false,
              ...field,
            },
          ],
          views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      fixture.repository.findOne.mockResolvedValue(ok(source));
      fixture.loadForeign.mockImplementation(async () => {
        throw new Error('Unreadable metadata must not load');
      });
      const prepared = (
        await fixture.service.preparePreview(context, fixture.container, candidate, {})
      )._unsafeUnwrap();
      if (prepared.operation !== 'field.delete') throw new Error('Expected deletion preparation');
      const facts = prepared.facts._unsafeUnwrap();
      const command = DeleteFieldsCommand.create({
        baseId: source.baseId().toString(),
        tableId,
        fieldIds: [fieldId],
      })._unsafeUnwrap();
      const planner = new FieldDeletePreviewPlanner(fixture.deletion, {
        canReadResource: async () => ok(true),
      });
      const plan = (
        await planner.previewPrepared(context, command, prepared.facts, options)
      )._unsafeUnwrap();
      expect(plan.blockers).toEqual([]);
      expect(plan.warnings).toContainEqual(
        expect.objectContaining({ code: 'field.delete.foreign_metadata_missing' })
      );
      expect(JSON.stringify(plan)).not.toContain(computedForeignId);
      expect(facts.projectedTable.getFields().map((value) => value.id().toString())).toEqual([
        titleId,
        sourceLinkId,
      ]);
      expect(source.getFields().map((value) => value.id().toString())).toEqual([
        titleId,
        sourceLinkId,
        fieldId,
      ]);
      expect(() =>
        fixture.service.signCandidate(
          candidate,
          { appId: 'app-one', accessToken: 'token' },
          prepared.projectedTables
        )
      ).toThrow(ForbiddenException);
    }
  );
});

describe('canonical conversion candidates', () => {
  it('uses shared v1 mapping and core conversion invariants without persistence or lifecycle access', async () => {
    const { service, table, repository } = await setup();
    repository.findOne.mockResolvedValueOnce(ok(table)).mockImplementation(async () => {
      throw new Error('Source changed after admission: a second load must not occur');
    });
    const conversion = {
      operation: 'convert' as const,
      tableId,
      fieldId,
      field: { name: 'Amount', type: 'singleLineText' },
    };
    const prepared = (await service.prepareCandidate(conversion))._unsafeUnwrap();
    expect(
      prepared
        .get(tableId)!
        .getField((field) => field.id().toString() === fieldId)
        ._unsafeUnwrap()
        .type()
        .toString()
    ).toBe('singleLineText');
    expect(repository.findOne).toHaveBeenCalledTimes(1);
    repository.findOne.mockResolvedValue(ok(table));
    expect(
      table
        .getField((field) => field.id().toString() === fieldId)
        ._unsafeUnwrap()
        .type()
        .toString()
    ).toBe('number');
    const invalid = await service.prepareCandidate({
      ...conversion,
      field: { type: 'not-a-field-type' },
    });
    expect(invalid.isErr()).toBe(true);
    expect(invalid._unsafeUnwrapErr().tags).toContain('validation');
  });
});

describe('candidate editor authorization and read-only routing', () => {
  const targetId = `tbl${'c'.repeat(16)}`;
  const missingId = `tbl${'d'.repeat(16)}`;
  const linkCandidate = (foreignTableId: string) => ({
    operation: 'convert' as const,
    tableId,
    fieldId,
    field: { type: 'link', options: { relationship: 'manyOne', foreignTableId, isOneWay: true } },
  });

  it('rejects unreadable and out-of-PAT-base targets identically before foreign metadata loads', async () => {
    const fixture = await setup({
      tokenId: 'pat-source-only',
      deniedForeignIds: [targetId, missingId],
      foreignTablePresent: true,
    });
    const responses = [];
    for (const id of [targetId, missingId]) {
      const result = await fixture.service.prepareCandidate(linkCandidate(id));
      const failure = result._unsafeUnwrapErr();
      responses.push({ code: failure.code, message: failure.message, tags: failure.tags });
      expect(failure.details).toBeUndefined();
      expect(fixture.validPermissions).toHaveBeenCalledWith(id, ['record|read'], 'pat-source-only');
    }
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0].code).toBe('preview.authorization.forbidden');
    expect(fixture.loadForeign).not.toHaveBeenCalled();
    expect(fixture.normalAcquisition).not.toHaveBeenCalled();
    expect(fixture.hiddenAcquisition).not.toHaveBeenCalled();
  });

  it('prepares an admitted same-base foreign conversion using the actual detached domain pipeline', async () => {
    const fixture = await setup({ tokenId: 'pat-readable-target', foreignTablePresent: true });
    const result = await fixture.service.prepareCandidate(linkCandidate(targetId));
    expect(
      result
        ._unsafeUnwrap()
        .get(tableId)!
        .getField((field) => field.id().toString() === fieldId)
        ._unsafeUnwrap()
        .type()
        .toString()
    ).toBe('link');
    expect(
      fixture.table
        .getField((field) => field.id().toString() === fieldId)
        ._unsafeUnwrap()
        .type()
        .toString()
    ).toBe('number');
    expect(fixture.validPermissions).toHaveBeenCalledWith(
      targetId,
      ['record|read'],
      'pat-readable-target'
    );
    expect(fixture.loadForeign).toHaveBeenCalled();
    expect(fixture.normalAcquisition).not.toHaveBeenCalled();
    expect(fixture.hiddenAcquisition).not.toHaveBeenCalled();
  });

  it('invokes registered matrix preview policy before foreign preparation', async () => {
    const fixture = await setup({ matrixDenied: true });
    const result = await fixture.service.prepareCandidate(linkCandidate(targetId));
    expect(result._unsafeUnwrapErr().code).toBe('preview.authorization.forbidden');
    expect(fixture.authorize).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ operation: 'field.convert' }),
      expect.anything()
    );
    expect(fixture.loadForeign).not.toHaveBeenCalled();
    expect(fixture.normalAcquisition).not.toHaveBeenCalled();
  });

  it('denies captured S0 references even when the general source authorizer reloads S1 without them', async () => {
    const fixture = await setup({ matrixDenied: false });
    const sourceWithLink = fixture.mapper
      .toDomain({
        id: tableId,
        baseId: `bse${'a'.repeat(16)}`,
        name: 'Source',
        primaryFieldId: titleId,
        dbTableName: 'base.candidate',
        fields: [
          { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
          {
            id: fieldId,
            name: 'Owner',
            type: 'link',
            dbFieldName: 'owner',
            options: {
              relationship: 'manyOne',
              foreignTableId: targetId,
              lookupFieldId: `fld${'c'.repeat(16)}`,
              isOneWay: true,
              fkHostTableName: 'base.candidate',
              selfKeyName: '__id',
              foreignKeyName: 'owner_fk',
            },
          },
        ],
        views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      })
      ._unsafeUnwrap();
    fixture.repository.findOne
      .mockResolvedValueOnce(ok(sourceWithLink))
      .mockResolvedValue(ok(fixture.table));
    fixture.authorize.mockImplementation(async () => {
      // Models the independent policy reload after a concurrent edit removed T.
      const newer = (await fixture.repository.findOne(context, expect.anything()))._unsafeUnwrap();
      expect(
        newer
          .getField((field) => field.id().toString() === fieldId)
          ._unsafeUnwrap()
          .type()
          .toString()
      ).toBe('number');
      return ok(undefined);
    });
    fixture.authorizeForeignTables.mockImplementation(async (_context, ids) =>
      ids.includes(targetId)
        ? err(
            domainError.forbidden({
              code: 'preview.authorization.forbidden',
              message: 'Preview access denied',
            })
          )
        : ok(undefined)
    );
    const descriptor = {
      operation: 'convert' as const,
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    };
    const result = await fixture.service.prepareCandidate(descriptor);
    expect(result._unsafeUnwrapErr().code).toBe('preview.authorization.forbidden');
    expect(fixture.authorizeForeignTables).toHaveBeenCalledWith(context, [targetId]);
    expect(fixture.loadForeign).not.toHaveBeenCalled();
    expect(() =>
      fixture.service.signCandidate(
        descriptor,
        { appId: 'app-one', accessToken: 'app-token' },
        new Map()
      )
    ).toThrow(ForbiddenException);
  });

  it('rejects an insufficient source PAT before any container or schema read', async () => {
    const fixture = await setup({ tokenId: 'pat-no-field-update', sourceTokenDenied: true });
    const result = await fixture.service.prepareCandidate(linkCandidate(targetId));
    expect(result._unsafeUnwrapErr().code).toBe('preview.authorization.forbidden');
    expect(fixture.getContainer).not.toHaveBeenCalled();
    expect(fixture.repository.findOne).not.toHaveBeenCalled();
    expect(fixture.loadForeign).not.toHaveBeenCalled();
  });

  it('fails unavailable read-only routing instead of acquiring a normal migrating container', async () => {
    const fixture = await setup({ previewUnavailable: true });
    const result = await fixture.service.prepareCandidate(candidate);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.candidate_route_unavailable',
      tags: ['infrastructure'],
    });
    expect(fixture.getContainer).toHaveBeenCalledWith(tableId);
    expect(fixture.normalAcquisition).not.toHaveBeenCalled();
    expect(fixture.repository.findOne).not.toHaveBeenCalled();
  });

  it('requires an actual matching editor admission capability to mint a proof', async () => {
    const { service } = await setup();
    expect(() =>
      service.signCandidate(candidate, { appId: 'app-one', accessToken: 'app-token' }, new Map())
    ).toThrow(ForbiddenException);
    const prepared = (await service.prepareCandidate(candidate))._unsafeUnwrap();
    expect(() =>
      service.signCandidate(
        { ...candidate, fieldIds: [titleId] },
        { appId: 'app-one', accessToken: 'app-token' },
        prepared
      )
    ).toThrow(ForbiddenException);
  });

  it('rejects newly introduced foreign references after editor admission without substituting the App actor', async () => {
    const fixture = await setup();
    const descriptor = {
      operation: 'convert' as const,
      tableId,
      fieldId,
      field: { type: 'singleLineText' },
    };
    const prepared = (await fixture.service.prepareCandidate(descriptor))._unsafeUnwrap();
    const proof = fixture.service.signCandidate(
      descriptor,
      { appId: 'app-one', accessToken: 'app-token' },
      prepared
    );
    const changed = fixture.mapper
      .toDomain({
        id: tableId,
        baseId: `bse${'a'.repeat(16)}`,
        name: 'Candidate',
        primaryFieldId: titleId,
        dbTableName: 'base.candidate',
        fields: [
          { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
          {
            id: fieldId,
            name: 'Owner',
            type: 'link',
            dbFieldName: 'owner',
            options: {
              relationship: 'manyOne',
              foreignTableId: targetId,
              lookupFieldId: `fld${'c'.repeat(16)}`,
              isOneWay: true,
              fkHostTableName: 'base.candidate',
              selfKeyName: '__id',
              foreignKeyName: 'owner_fk',
            },
          },
        ],
        views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      })
      ._unsafeUnwrap();
    fixture.repository.findOne.mockResolvedValue(ok(changed));
    fixture.loadForeign.mockClear();
    fixture.validPermissions.mockClear();
    const appContext = { actorId: ActorId.create('app-actor')._unsafeUnwrap() };
    const result = await fixture.service.prepareAuthorizedCandidate(
      appContext,
      descriptor,
      proof,
      'app-token'
    );
    expect(result._unsafeUnwrapErr().code).toBe('data_query.candidate_forbidden');
    expect(fixture.loadForeign).not.toHaveBeenCalled();
    expect(fixture.validPermissions).not.toHaveBeenCalled();
    expect(fixture.repository.findOne.mock.lastCall?.[0]).toBe(appContext);
  });
});

describe('V2DataQueryCandidateService', () => {
  it.each([null, 'app-other'])(
    'rejects proof for another or missing authenticated App with shared bearer (%s)',
    async (authenticatedAppId) => {
      const signer = await setup();
      const verifier = await setup({ authenticatedAppId });
      const prepared = (await signer.service.prepareCandidate(candidate))._unsafeUnwrap();
      const proof = signer.service.signCandidate(
        candidate,
        { appId: 'app-one', accessToken: 'shared-legacy-bearer' },
        prepared
      );
      const result = await verifier.service.prepareAuthorizedCandidate(
        context,
        candidate,
        proof,
        'shared-legacy-bearer'
      );
      expect(result._unsafeUnwrapErr().code).toBe('data_query.candidate_forbidden');
      expect(verifier.getContainer).not.toHaveBeenCalled();
      expect(verifier.repository.findOne).not.toHaveBeenCalled();
    }
  );

  it('establishes readonly policy scope without changing actor or leaking marker into caller', async () => {
    const fixture = await setup();
    (await fixture.service.prepareCandidate(candidate))._unsafeUnwrap();
    expect(fixture.cls.runWith).toHaveBeenCalledWith(
      expect.objectContaining({ v2PreviewReadOnly: true, appId: 'app-one' }),
      expect.any(Function)
    );
    expect(fixture.cls.get('v2PreviewReadOnly')).toBeUndefined();
    expect(fixture.repository.findOne.mock.calls[0][0]).toBe(context);
  });
  it('rejects missing, forged, wrong-bearer and altered-command proofs before metadata reads', async () => {
    const { service, getContainer } = await setup();
    const prepared = (await service.prepareCandidate(candidate))._unsafeUnwrap();
    const proof = service.signCandidate(
      candidate,
      { appId: 'app-one', accessToken: 'app-token' },
      prepared
    );
    getContainer.mockClear();
    for (const [descriptor, credential, bearer] of [
      [candidate, undefined, 'app-token'],
      [candidate, `${proof}tampered`, 'app-token'],
      [candidate, proof, 'different-app-token'],
      [{ ...candidate, fieldIds: [titleId] }, proof, 'app-token'],
    ] as const) {
      const result = await service.prepareAuthorizedCandidate(
        context,
        descriptor,
        credential,
        bearer
      );
      expect(result._unsafeUnwrapErr().code).toBe('data_query.candidate_forbidden');
    }
    expect(getContainer).not.toHaveBeenCalled();
  });

  it('rejects expired proof and verifies valid proof across independent service instances', async () => {
    const first = await setup();
    const second = await setup();
    const prepared = (await first.service.prepareCandidate(candidate))._unsafeUnwrap();
    const proof = first.service.signCandidate(
      candidate,
      {
        appId: 'app-one',
        accessToken: 'app-token',
      },
      prepared
    );
    expect(
      (
        await second.service.prepareAuthorizedCandidate(context, candidate, proof, 'app-token')
      ).isOk()
    ).toBe(true);
    second.getContainer.mockClear();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      const expired = await second.service.prepareAuthorizedCandidate(
        context,
        candidate,
        proof,
        'app-token'
      );
      expect(expired._unsafeUnwrapErr().code).toBe('data_query.candidate_forbidden');
      expect(second.getContainer).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts equivalent command and field key ordering in signed proofs', async () => {
    const { service, getContainer } = await setup();
    const descriptor = {
      operation: 'convert' as const,
      tableId,
      fieldId,
      field: {
        name: 'Amount',
        type: 'number',
        options: { formatting: { type: 'decimal', precision: 2 } },
      },
    };
    const prepared = (await service.prepareCandidate(descriptor))._unsafeUnwrap();
    const proof = service.signCandidate(
      descriptor,
      { appId: 'app-one', accessToken: 'app-token' },
      prepared
    );
    getContainer.mockClear();
    const reordered = {
      field: {
        options: { formatting: { precision: 2, type: 'decimal' } },
        type: 'number',
        name: 'Amount',
      },
      fieldId,
      tableId,
      operation: 'convert' as const,
    };
    expect(
      (await service.prepareAuthorizedCandidate(context, reordered, proof, 'app-token')).isOk()
    ).toBe(true);
    expect(getContainer).toHaveBeenCalledWith(tableId);
  });

  it('uses domain delete rules on detached schemas without persistence or lifecycle collaborators', async () => {
    const { service, table } = await setup();
    const result = (await service.prepareCandidate(candidate))._unsafeUnwrap();
    expect(
      result
        .get(tableId)!
        .getField((field) => field.id().toString() === fieldId)
        .isErr()
    ).toBe(true);
    expect(table.getField((field) => field.id().toString() === fieldId).isOk()).toBe(true);
    const primary = await service.prepareCandidate({ ...candidate, fieldIds: [titleId] });
    expect(primary.isErr()).toBe(true);
    const missing = await service.prepareCandidate({
      ...candidate,
      fieldIds: [`fld${'z'.repeat(16)}`],
    });
    expect(missing.isErr()).toBe(true);
  });
});
