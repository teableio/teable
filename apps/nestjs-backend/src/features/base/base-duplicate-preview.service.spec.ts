import { FieldType } from '@teable/core';
import { BaseDuplicateMode } from '@teable/openapi';
import { PreviewPlannerRegistry, type PreviewOptions } from '@teable/v2-command-explain';
import type { IExecutionContext } from '@teable/v2-core';
import {
  BaseDuplicatePreviewPlanner,
  BaseDuplicatePreviewRegistrar,
  parseBaseDuplicatePreviewInput,
} from './base-duplicate-preview.service';
import { BaseDuplicateService, type DuplicateBaseV2PreviewFacts } from './base-duplicate.service';
import type { BaseService } from './base.service';

const context = { requestId: 'preview-request' } as IExecutionContext;
const options: PreviewOptions = { detail: 'full', includeComplexity: false, maxItems: 100 };

const duplicateRo = {
  fromBaseId: 'bseSource',
  spaceId: 'spcTarget',
  withRecords: true,
  name: 'Copied base',
  baseId: 'bseTarget',
  nodes: ['nodTable', 'nodFolder'],
  shareId: 'shrSource',
  timeZone: 'America/New_York',
};

const facts = (
  overrides: Partial<DuplicateBaseV2PreviewFacts> = {}
): DuplicateBaseV2PreviewFacts => ({
  input: {
    ...duplicateRo,
    withRecords: true,
    allowCrossBase: true,
    duplicateMode: BaseDuplicateMode.Normal,
  },
  selection: {
    resources: 18,
    bases: 1,
    tables: 2,
    fields: 8,
    views: 4,
    nodes: 3,
  },
  records: { basis: 'exact', value: 27 },
  links: {
    sameSpacePreserved: 2,
    crossSpaceConverted: 5,
    optionDisabledConverted: 0,
    partialSelectionDisconnected: 3,
    unclassifiedExternal: 0,
  },
  ...overrides,
});

const createPlanner = (previewFacts: DuplicateBaseV2PreviewFacts) => {
  const write = vi.fn();
  const event = vi.fn();
  const hook = vi.fn();
  const prepareDuplicateBaseV2 = vi.fn().mockResolvedValue({
    preview: previewFacts,
    execution: {
      sourceDbTableNameByTableId: { tblSource: 'private_schema.private_table' },
      physicalWriteHook: hook,
    },
  });
  const previewDuplicateBaseV2Admission = vi.fn().mockResolvedValue({
    blockers: [],
    warnings: [],
    knownCoverage: [],
    unknownCoverage: [],
  });
  const previewDuplicateBaseV1DataRoute = vi.fn().mockResolvedValue({
    blockers: [],
    warnings: [],
    knownCoverage: ['host.cross-database.copy'],
    unknownCoverage: [],
  });
  const planDuplicateBaseV2Preview = vi.fn().mockResolvedValue({
    resolvedConcerns: [],
    effects: [],
    blockers: [],
    warnings: [],
    knownCoverage: [],
    unknownCoverage: [],
  });
  const previewDuplicateBaseV2 = vi.fn().mockResolvedValue({
    useV2: true,
    reason: 'space_feature',
  });
  const duplicateService = {
    previewDuplicateBaseV2Admission,
    previewDuplicateBaseV1DataRoute,
    prepareDuplicateBaseV2,
    planDuplicateBaseV2Preview,
    duplicateBaseV2: write,
    duplicateBase: write,
    event,
    hook,
  } as unknown as BaseDuplicateService;
  const baseService = {
    previewDuplicateBaseV2,
    duplicateBaseV2: write,
    duplicateBase: write,
    event,
    hook,
  } as unknown as BaseService;
  return {
    planner: new BaseDuplicatePreviewPlanner(duplicateService, baseService),
    previewDuplicateBaseV1DataRoute,
    previewDuplicateBaseV2Admission,
    prepareDuplicateBaseV2,
    planDuplicateBaseV2Preview,
    previewDuplicateBaseV2,
    write,
    event,
    hook,
  };
};

describe('base duplicate preview input', () => {
  it('parses exactly the advertised duplicate route input', () => {
    const parsed = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    expect(parsed).toEqual({ duplicateBaseRo: duplicateRo });
  });

  it.each([
    [
      { ...duplicateRo, allowCrossBase: false },
      'preview.base.duplicate.allow_cross_base_unsupported',
    ],
    [
      { ...duplicateRo, duplicateMode: BaseDuplicateMode.ApplyTemplate },
      'preview.base.duplicate.mode_unsupported',
    ],
    [{ ...duplicateRo, fromBaseId: undefined }, 'preview.base.duplicate.invalid_input'],
  ])('rejects inputs that the advertised write route cannot honor', (input, code) => {
    expect(parseBaseDuplicatePreviewInput(input)._unsafeUnwrapErr().code).toBe(code);
  });
});

describe('BaseDuplicatePreviewPlanner', () => {
  it('reports exact selection and row counts plus preserved, converted, and disconnected links', async () => {
    const harness = createPlanner(facts());
    const input = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    const plan = (await harness.planner.preview(context, input, options))._unsafeUnwrap();
    const effects = Object.fromEntries(plan.effects.map((effect) => [effect.code, effect]));

    expect(harness.previewDuplicateBaseV2).toHaveBeenCalledWith(context, duplicateRo);
    expect(harness.prepareDuplicateBaseV2).toHaveBeenCalledWith(duplicateRo);
    expect(effects['base.duplicate.structure.selected']?.measures).toEqual({
      tables: { basis: 'exact', value: 2, unit: 'tables' },
      fields: { basis: 'exact', value: 8, unit: 'fields' },
      views: { basis: 'exact', value: 4, unit: 'views' },
      nodes: { basis: 'exact', value: 3, unit: 'nodes' },
    });
    expect(effects['base.duplicate.resources.selected']?.measures.resources).toEqual({
      basis: 'exact',
      value: 18,
      unit: 'resources',
    });
    expect(effects['base.duplicate.records.copy']?.measures.records).toEqual({
      basis: 'exact',
      value: 27,
      unit: 'records',
    });
    expect(effects['base.duplicate.link.same_space_preserved']?.measures.fields).toEqual({
      basis: 'exact',
      value: 2,
      unit: 'fields',
    });
    expect(effects['base.duplicate.link.cross_space_converted']?.measures.fields).toEqual({
      basis: 'exact',
      value: 5,
      unit: 'fields',
    });
    expect(effects['base.duplicate.link.partial_selection_disconnected']?.measures.fields).toEqual({
      basis: 'exact',
      value: 3,
      unit: 'fields',
    });
    expect(plan.coverage.unknown).toEqual(
      expect.arrayContaining([
        'host.attachments',
        'host.app-runtime.extras',
        'host.workflows',
        'host.authority',
        'host.shares',
        'host.billing.quota',
      ])
    );
    expect(plan.effects.map(({ code }) => code)).not.toContain(
      'base.duplicate.table_copy.v2_cross_space_blocked'
    );
    expect(JSON.stringify(plan)).not.toContain('private_schema.private_table');
  });

  it('uses unknown row evidence instead of inventing zero and makes no copy-mode promise', async () => {
    const harness = createPlanner(
      facts({ records: { basis: 'unknown', reason: 'source-row-count-unavailable' } })
    );
    const input = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    const plan = (await harness.planner.preview(context, input, options))._unsafeUnwrap();
    const records = plan.effects.find(({ code }) => code === 'base.duplicate.records.copy');

    expect(records?.measures.records).toEqual({
      basis: 'unknown',
      unit: 'records',
      reason: 'Exact source row count could not be read',
    });
    expect(plan.coverage.unknown).toContain('records.source-row-count');
    expect(plan.warnings.map(({ code }) => code)).toContain('base.duplicate.records.count_unknown');
    expect(plan.effects.map(({ code }) => code).join(' ')).not.toMatch(/bulk|stream/);
  });

  it('performs only the read-only guard and preparation seams during preview', async () => {
    const harness = createPlanner(facts());
    const input = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    await harness.planner.preview(context, input, options);

    expect(harness.previewDuplicateBaseV2).toHaveBeenCalledTimes(1);
    expect(harness.previewDuplicateBaseV2Admission).toHaveBeenCalledTimes(1);
    expect(harness.prepareDuplicateBaseV2).toHaveBeenCalledTimes(1);
    expect(harness.write).not.toHaveBeenCalled();
    expect(harness.event).not.toHaveBeenCalled();
    expect(harness.hook).not.toHaveBeenCalled();
  });

  it('composes overrideable edition blockers and effects without retaining request state', async () => {
    const harness = createPlanner(facts());
    harness.planDuplicateBaseV2Preview.mockResolvedValue({
      resolvedConcerns: ['billing.quota'],
      effects: [
        {
          code: 'base.duplicate.billing.quota.checked',
          kind: 'host.effect',
          measures: {},
        },
      ],
      blockers: [{ code: 'base.duplicate.billing.quota.blocked', message: 'Quota exceeded.' }],
      warnings: [],
      knownCoverage: ['host.billing.quota'],
      unknownCoverage: [],
    });
    const input = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    const plan = (await harness.planner.preview(context, input, options))._unsafeUnwrap();

    expect(harness.planDuplicateBaseV2Preview).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ preview: expect.any(Object) })
    );
    expect(plan.blockers.map(({ code }) => code)).toContain('base.duplicate.billing.quota.blocked');
    expect(plan.effects.map(({ code }) => code)).toContain('base.duplicate.billing.quota.checked');
    expect(plan.coverage.known).toContain('host.billing.quota');
    expect(plan.coverage.unknown).not.toContain('host.billing.quota');
  });

  it('uses the destination-selected legacy engine guard before structure or row-count reads', async () => {
    const harness = createPlanner(facts());
    harness.previewDuplicateBaseV2.mockResolvedValue({
      useV2: false,
      reason: 'feature_not_enabled',
    });
    harness.previewDuplicateBaseV1DataRoute.mockResolvedValue({
      blockers: [{ code: 'base.duplicate.v1.cross_database_records_blocked' }],
      warnings: [],
      knownCoverage: ['host.cross-database.copy'],
      unknownCoverage: [],
    });
    const input = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    const plan = (await harness.planner.preview(context, input, options))._unsafeUnwrap();

    expect(harness.previewDuplicateBaseV2).toHaveBeenCalledWith(context, duplicateRo);
    expect(harness.previewDuplicateBaseV1DataRoute).toHaveBeenCalledWith(duplicateRo);
    expect(plan.blockers).toEqual([{ code: 'base.duplicate.v1.cross_database_records_blocked' }]);
    expect(harness.prepareDuplicateBaseV2).not.toHaveBeenCalled();
  });

  it('returns edition blockers before reading structure or row counts', async () => {
    const harness = createPlanner(facts());
    harness.previewDuplicateBaseV2Admission.mockResolvedValue({
      blockers: [{ code: 'base.duplicate.authority.restricted' }],
      warnings: [],
      knownCoverage: ['host.authority.admission'],
      unknownCoverage: [],
    });
    const input = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    const plan = (await harness.planner.preview(context, input, options))._unsafeUnwrap();

    expect(plan.effects).toEqual([]);
    expect(plan.blockers).toEqual([{ code: 'base.duplicate.authority.restricted' }]);
    expect(harness.previewDuplicateBaseV2).toHaveBeenCalledWith(context, duplicateRo);
    expect(harness.previewDuplicateBaseV2.mock.invocationCallOrder[0]).toBeLessThan(
      harness.previewDuplicateBaseV2Admission.mock.invocationCallOrder[0]!
    );
    expect(harness.prepareDuplicateBaseV2).not.toHaveBeenCalled();
    expect(harness.planDuplicateBaseV2Preview).not.toHaveBeenCalled();
  });

  it('stops before preparation when live host authorization or migration checks block', async () => {
    const harness = createPlanner(facts());
    harness.previewDuplicateBaseV2.mockRejectedValue(new Error('blocked'));
    const input = parseBaseDuplicatePreviewInput(duplicateRo)._unsafeUnwrap();

    const plan = (await harness.planner.preview(context, input, options))._unsafeUnwrap();

    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: 'base.duplicate.host_checks.blocked' }),
    ]);
    expect(harness.prepareDuplicateBaseV2).not.toHaveBeenCalled();
  });
});
describe('BaseDuplicateService prepareDuplicateBaseV2', () => {
  type ServiceArgs = ConstructorParameters<typeof BaseDuplicateService>;
  type PreparationInternals = {
    buildDuplicateStructureConfig: (...args: unknown[]) => Promise<unknown>;
    getV2CrossBaseLinkFieldTableMap: (...args: unknown[]) => Promise<unknown>;
    getV2DisconnectedLinkFieldTableMap: (...args: unknown[]) => Promise<unknown>;
    getV2InternalLinkRelationTableMap: (...args: unknown[]) => Promise<unknown>;
    getV2BulkCopySourceLinkFields: (...args: unknown[]) => Promise<unknown>;
    normalizeDuplicateStructureForV2: (structure: unknown) => unknown;
    createNativeTableSnapshots: (...args: unknown[]) => Promise<ReadonlyMap<string, unknown>>;
    createDuplicateBaseSource: (...args: unknown[]) => unknown;
    summarizeProjectedFieldConversions: (
      fields: ReadonlyArray<unknown>,
      structure: unknown,
      excludedTableIds?: ReadonlyArray<string>
    ) => { external: number; partialSelection: number };
  };

  const setup = (
    countRows: (...args: unknown[]) => Promise<Array<{ count: bigint | number | string }>>,
    fieldConversions = { external: 0, partialSelection: 0 }
  ) => {
    const execute = vi.fn();
    const dataDbClientManager = {
      dataPrismaForBasePreviewReadOnly: vi.fn().mockResolvedValue({
        $queryRawUnsafe: countRows,
        $executeRawUnsafe: execute,
      }),
      dataPrismaForBase: vi.fn(),
      getDataDatabaseForBasePreviewReadOnly: vi
        .fn()
        .mockResolvedValue({ cacheKey: 'meta-fallback' }),
      getDataDatabaseForSpacePreviewReadOnly: vi
        .fn()
        .mockResolvedValue({ cacheKey: 'meta-fallback' }),
    };
    const knex = vi.fn().mockImplementation((tableName: string) => ({
      count: vi.fn().mockReturnValue({ toQuery: () => `count ${tableName}` }),
    }));
    const service = new BaseDuplicateService(
      {
        txClient: vi.fn().mockReturnValue({ base: { findMany: vi.fn() } }),
      } as unknown as ServiceArgs[0],
      {} as ServiceArgs[1],
      {} as ServiceArgs[2],
      {} as ServiceArgs[3],
      {} as ServiceArgs[4],
      knex as unknown as ServiceArgs[5],
      {} as ServiceArgs[6],
      { get: vi.fn() } as unknown as ServiceArgs[7],
      dataDbClientManager as unknown as ServiceArgs[8],
      { getPreviewContainerForTable: vi.fn() } as unknown as ServiceArgs[9],
      {} as ServiceArgs[10],
      {} as ServiceArgs[11]
    );
    const internals = service as unknown as PreparationInternals;
    const structure = {
      id: 'bseSource',
      name: 'Copied base',
      tables: [
        { id: 'tblA', name: 'A', fields: [{ id: 'fldA', type: 'singleLineText' }], views: [] },
        { id: 'tblB', name: 'B', fields: [], views: [{ id: 'viwB' }] },
      ],
      nodes: [{ id: 'nodA' }, { id: 'nodB' }],
      folders: [],
      plugins: [],
    };
    vi.spyOn(internals, 'buildDuplicateStructureConfig').mockResolvedValue({
      structure,
      sourceDbTableNameByTableId: { tblA: 'schema.tbl_a', tblB: 'schema.tbl_b' },
      fieldConversions,
    });
    vi.spyOn(internals, 'getV2CrossBaseLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2DisconnectedLinkFieldTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2InternalLinkRelationTableMap').mockResolvedValue({});
    vi.spyOn(internals, 'getV2BulkCopySourceLinkFields').mockResolvedValue([]);
    vi.spyOn(internals, 'normalizeDuplicateStructureForV2').mockReturnValue(structure);
    vi.spyOn(internals, 'createNativeTableSnapshots').mockResolvedValue(new Map());
    vi.spyOn(internals, 'createDuplicateBaseSource').mockReturnValue({ records: vi.fn() });
    return { service, dataDbClientManager, execute };
  };

  it('counts every selected source table exactly using read-only queries', async () => {
    const countRows = vi
      .fn()
      .mockResolvedValueOnce([{ count: 11n }])
      .mockResolvedValueOnce([{ count: 4n }]);
    const harness = setup(countRows);

    const preparation = await harness.service.prepareDuplicateBaseV2(
      duplicateRo,
      true,
      BaseDuplicateMode.ApplyTemplate
    );

    expect(preparation.preview.records).toEqual({ basis: 'exact', value: 15 });
    expect(preparation.preview.input).toEqual({
      ...duplicateRo,
      withRecords: true,
      allowCrossBase: true,
      duplicateMode: BaseDuplicateMode.ApplyTemplate,
    });
    expect(preparation.preview.selection).toEqual({
      resources: 7,
      bases: 1,
      tables: 2,
      fields: 1,
      views: 1,
      nodes: 2,
    });
    expect(harness.dataDbClientManager.dataPrismaForBasePreviewReadOnly).toHaveBeenCalledWith(
      'bseSource'
    );
    expect(harness.dataDbClientManager.dataPrismaForBase).not.toHaveBeenCalled();
    expect(countRows).toHaveBeenCalledTimes(2);
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('returns unknown row evidence when an exact read-only count is unavailable', async () => {
    const harness = setup(vi.fn().mockRejectedValue(new Error('unavailable')));

    const preparation = await harness.service.prepareDuplicateBaseV2(
      duplicateRo,
      true,
      BaseDuplicateMode.ApplyTemplate
    );

    expect(preparation.preview.records).toEqual({
      basis: 'unknown',
      reason: 'source-row-count-unavailable',
    });
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('blocks the legacy record-copy path when ready routing proves different data databases', async () => {
    const harness = setup(vi.fn());
    harness.dataDbClientManager.getDataDatabaseForBasePreviewReadOnly.mockResolvedValue({
      cacheKey: 'source-db',
    });
    harness.dataDbClientManager.getDataDatabaseForSpacePreviewReadOnly.mockResolvedValue({
      cacheKey: 'destination-db',
    });

    const admission = await harness.service.previewDuplicateBaseV1DataRoute(duplicateRo);

    expect(admission.blockers).toEqual([
      expect.objectContaining({ code: 'base.duplicate.v1.cross_database_records_blocked' }),
    ]);
    expect(harness.dataDbClientManager.dataPrismaForBase).not.toHaveBeenCalled();
  });

  it('reports unknown legacy record-copy evidence when ready routing metadata is unavailable', async () => {
    const harness = setup(vi.fn());
    harness.dataDbClientManager.getDataDatabaseForBasePreviewReadOnly.mockResolvedValue(null);

    const admission = await harness.service.previewDuplicateBaseV1DataRoute(duplicateRo);

    expect(admission.blockers).toEqual([]);
    expect(admission.unknownCoverage).toContain('host.cross-database.copy');
    expect(admission.warnings).toEqual([
      expect.objectContaining({ code: 'base.duplicate.cross_database.route_unknown' }),
    ]);
  });

  it('derives conditional and dependent conversion counts from the exported field projection', () => {
    const harness = setup(vi.fn());
    const internals = harness.service as unknown as PreparationInternals;
    const fields = [
      {
        id: 'fldExternalLink',
        type: FieldType.Link,
        isLookup: false,
        isConditionalLookup: false,
        options: { foreignTableId: 'tblExternal' },
        lookupOptions: null,
      },
      {
        id: 'fldExternalLookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: false,
        options: null,
        lookupOptions: { linkFieldId: 'fldExternalLink' },
      },
      {
        id: 'fldExternalRollup',
        type: FieldType.Rollup,
        isLookup: false,
        isConditionalLookup: false,
        options: null,
        lookupOptions: { linkFieldId: 'fldExternalLink' },
      },
      {
        id: 'fldConditionalLookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        options: null,
        lookupOptions: { foreignTableId: 'tblExternal' },
      },
      {
        id: 'fldConditionalRollup',
        type: FieldType.ConditionalRollup,
        isLookup: false,
        isConditionalLookup: false,
        options: { foreignTableId: 'tblExternal' },
        lookupOptions: null,
      },
      {
        id: 'fldPartialLink',
        type: FieldType.Link,
        isLookup: false,
        isConditionalLookup: false,
        options: { foreignTableId: 'tblExcluded' },
        lookupOptions: null,
      },
      {
        id: 'fldPartialLookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: false,
        options: null,
        lookupOptions: { linkFieldId: 'fldPartialLink' },
      },
    ];
    const structure = {
      tables: [
        {
          fields: fields.map(({ id }) => ({ id, type: FieldType.SingleLineText })),
        },
      ],
    };

    expect(
      internals.summarizeProjectedFieldConversions(fields, structure, ['tblExcluded'])
    ).toEqual({ external: 5, partialSelection: 2 });
  });

  it('maps exact projected conversions into preview facts without executing writes', async () => {
    const countRows = vi.fn().mockResolvedValue([{ count: 0n }]);
    const harness = setup(countRows, { external: 5, partialSelection: 2 });

    const preparation = await harness.service.prepareDuplicateBaseV2(duplicateRo);

    expect(preparation.preview.input).toEqual(
      expect.objectContaining({
        allowCrossBase: true,
        duplicateMode: BaseDuplicateMode.Normal,
      })
    );
    expect(preparation.preview.links).toEqual({
      sameSpacePreserved: 0,
      crossSpaceConverted: 5,
      optionDisabledConverted: 0,
      partialSelectionDisconnected: 2,
      unclassifiedExternal: 0,
    });
    expect(harness.execute).not.toHaveBeenCalled();
  });
});

describe('BaseDuplicatePreviewRegistrar', () => {
  it('registers an idempotent partial host capability for every container registry', () => {
    const duplicateService = {} as BaseDuplicateService;
    const baseService = {} as BaseService;
    const registrar = new BaseDuplicatePreviewRegistrar(duplicateService, baseService);
    const registry = PreviewPlannerRegistry.empty();
    const container = { resolve: vi.fn().mockReturnValue(registry) };

    registrar.registerProjections(container as never);
    registrar.registerProjections(container as never);

    expect(registry.capabilities()).toContainEqual({
      operation: 'base.duplicate',
      canonicalWriteRoute: 'POST /base/duplicate',
      supportLevel: 'partial',
      requiredPermissionScope: 'target base|create; source base|update',
      detailLevels: ['summary', 'full'],
      limitations: expect.any(Array),
    });
  });
});
