import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { domainError, type IExecutionContext } from '@teable/v2-core';
import {
  buildComplexityAssessment,
  simulateSchemaComplexity,
  type OperationDescriptor,
} from '@teable/v2-complexity';

import {
  OperationPreviewService,
  PreviewPlannerRegistry,
  hostPreviewConcernValues,
  type IPreviewPlanner,
  type OperationPreviewPlan,
  type HostPreviewRegistration,
  type PreviewOperationRegistration,
} from '../index';

const context = {} as IExecutionContext;

const readyPlan = (): OperationPreviewPlan => ({
  effects: [
    {
      kind: 'field.conversion',
      code: 'field.convert.type_change',
      measures: {
        affectedCells: { basis: 'exact', value: 2, unit: 'cells' },
      },
    },
  ],
  blockers: [],
  warnings: [],
  coverage: { known: ['field-conversion'], unknown: [] },
  complexity: null,
  authorization: 'checked',
  consistency: 'snapshot',
});

const registration = (
  overrides: Partial<PreviewOperationRegistration<{ tableId: string }>> = {}
): PreviewOperationRegistration<{ tableId: string }> => {
  const planner: IPreviewPlanner<{ tableId: string }> = {
    operation: 'field.convert',
    plannerVersion: 'field-convert-v1',
    executionPath: 'UpdateFieldCommand',
    preview: vi.fn(async () => ok(readyPlan())),
  };

  return {
    operation: 'field.convert',
    parseInput: (input) => {
      if (
        typeof input !== 'object' ||
        input === null ||
        !('tableId' in input) ||
        typeof input.tableId !== 'string'
      ) {
        return err(
          domainError.validation({
            code: 'preview.input.invalid',
            message: 'tableId is required',
          })
        );
      }
      return ok({ tableId: input.tableId });
    },
    planner,
    capability: {
      canonicalWriteRoute: 'PATCH /tables/:tableId/fields/:fieldId',
      supportLevel: 'full',
      requiredPermissionScope: 'field:update',
      detailLevels: ['summary', 'full'],
      limitations: [],
    },
    ...overrides,
  };
};

const complexityFixture = (operation: OperationDescriptor, withStatistics: boolean) => {
  const profile = simulateSchemaComplexity({
    schema: {
      fields: [
        { id: 'fld_a', tableId: 'tbl_a', type: 'number', isComputed: false },
        { id: 'fld_b', tableId: 'tbl_a', type: 'formula', isComputed: true },
      ],
      edges: [
        {
          fromFieldId: 'fld_a',
          toFieldId: 'fld_b',
          fromTableId: 'tbl_a',
          toTableId: 'tbl_a',
          kind: 'same_record',
        },
      ],
    },
    operation,
    ...(withStatistics
      ? {
          assumptions: {
            rowCounts: { tbl_a: 100 },
            seedRecordCount: 4,
            changeRate: 0.5,
          },
        }
      : {}),
    completeness: 'complete',
  });
  return { profile, assessment: buildComplexityAssessment(profile) };
};

describe('OperationPreviewService', () => {
  it('dispatches parsed input and adds canonical response metadata', async () => {
    const entry = registration();
    const registry = PreviewPlannerRegistry.create([entry])._unsafeUnwrap();
    const service = new OperationPreviewService(registry, {
      now: () => new Date('2026-03-10T12:00:00.000Z'),
    });

    const result = await service.preview(context, {
      operation: 'field.convert',
      input: { tableId: 'tbl_a' },
      options: { detail: 'full' },
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(entry.planner.preview).toHaveBeenCalledWith(
      context,
      { tableId: 'tbl_a' },
      { detail: 'full', includeComplexity: false, maxItems: 100 }
    );
    expect(result.value).toMatchObject({
      operation: 'field.convert',
      outcome: 'ready',
      observedAt: '2026-03-10T12:00:00.000Z',
      complexity: null,
      implementation: {
        plannerVersion: 'field-convert-v1',
        executionPath: 'UpdateFieldCommand',
      },
    });
    expect(result.value.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('derives blocked and incomplete outcomes without treating missing evidence as ready', async () => {
    const blockedPlanner: IPreviewPlanner<{ tableId: string }> = {
      ...registration().planner,
      preview: async () =>
        ok({
          ...readyPlan(),
          blockers: [{ code: 'field.convert.blocked' }],
          coverage: { known: [], unknown: ['field-operation-policy'] },
        }),
    };
    const incompletePlanner: IPreviewPlanner<{ tableId: string }> = {
      ...registration().planner,
      preview: async () =>
        ok({
          ...readyPlan(),
          effects: [],
          coverage: { known: [], unknown: ['affected-record-count'] },
        }),
    };

    const blocked = await new OperationPreviewService(
      PreviewPlannerRegistry.create([registration({ planner: blockedPlanner })])._unsafeUnwrap()
    ).preview(context, { operation: 'field.convert', input: { tableId: 'tbl_a' } });
    const incomplete = await new OperationPreviewService(
      PreviewPlannerRegistry.create([registration({ planner: incompletePlanner })])._unsafeUnwrap()
    ).preview(context, { operation: 'field.convert', input: { tableId: 'tbl_a' } });

    expect(blocked._unsafeUnwrap().outcome).toBe('blocked');
    expect(incomplete._unsafeUnwrap().outcome).toBe('incomplete');
  });

  it('keeps complexity optional and passes the planner operation and assumptions', async () => {
    const operation: OperationDescriptor = {
      kind: 'update',
      tableId: 'tbl_a',
      changedFieldIds: ['fld_a'],
      beforeImage: 'available',
    };
    const plan: OperationPreviewPlan = {
      ...readyPlan(),
      complexityProjection: {
        tableId: 'tbl_a',
        operation,
        assumptions: { seedRecordCount: 4 },
        includeCatalogStats: true,
        authorizedTableIds: ['tbl_a'],
        coverage: { known: ['complexity-operation-descriptor'], unknown: [] },
        warnings: [],
      },
    };
    const entry = registration({
      planner: { ...registration().planner, preview: vi.fn(async () => ok(plan)) },
    });
    const complexityService = {
      assess: vi.fn(async () => ok(complexityFixture(operation, true))),
    };
    const service = new OperationPreviewService(
      PreviewPlannerRegistry.create([entry])._unsafeUnwrap(),
      { complexityService }
    );

    const withoutComplexity = await service.preview(context, {
      operation: 'field.convert',
      input: { tableId: 'tbl_a' },
    });
    expect(complexityService.assess).not.toHaveBeenCalled();
    expect(withoutComplexity._unsafeUnwrap().complexity).toBeNull();

    const withComplexity = await service.preview(context, {
      operation: 'field.convert',
      input: { tableId: 'tbl_a' },
      options: { includeComplexity: true },
    });
    expect(complexityService.assess).toHaveBeenCalledOnce();
    expect(complexityService.assess).toHaveBeenCalledWith(context, {
      tableId: 'tbl_a',
      operation,
      assumptions: { seedRecordCount: 4 },
      includeCatalogStats: true,
      assumeSingleRecordWhenSelectionUnknown: false,
      focusTableId: 'tbl_a',
      authorizedTableIds: ['tbl_a'],
    });
    expect(withComplexity._unsafeUnwrap().complexity).toEqual(
      complexityFixture(operation, true).assessment
    );
    expect(withComplexity._unsafeUnwrap().effects).toEqual(plan.effects);
    const complexity = withComplexity._unsafeUnwrap().complexity;
    expect(complexity?.workload.rows).toMatchObject({
      expected: expect.any(Number),
      lower: expect.any(Number),
      upper: expect.any(Number),
    });
    expect(complexity?.breakdown.paths[0]).toMatchObject({
      scan: {
        expected: expect.any(Number),
        lower: expect.any(Number),
        upper: expect.any(Number),
      },
      dirty: {
        expected: expect.any(Number),
        lower: expect.any(Number),
        upper: expect.any(Number),
      },
      estimatedWrites: {
        expected: expect.any(Number),
        lower: expect.any(Number),
        upper: expect.any(Number),
      },
    });
  });

  it('preserves the rich assessment and marks missing projection and statistics unknown', async () => {
    const operation: OperationDescriptor = {
      kind: 'update',
      tableId: 'tbl_a',
      changedFieldIds: ['fld_a'],
    };
    const resultFixture = complexityFixture(operation, false);
    const entry = registration({
      planner: {
        ...registration().planner,
        preview: vi.fn(async () =>
          ok({
            ...readyPlan(),
            complexityProjection: {
              tableId: 'tbl_a',
              operation,
              includeCatalogStats: true,
              coverage: {
                known: ['complexity-operation-descriptor'],
                unknown: ['complexity-planner-projection', 'complexity-selection'],
              },
              warnings: [
                {
                  code: 'preview.complexity.planner_projection_unknown',
                  message: 'Planner projection unavailable.',
                },
              ],
            },
          })
        ),
      },
    });
    const service = new OperationPreviewService(
      PreviewPlannerRegistry.create([entry])._unsafeUnwrap(),
      { complexityService: { assess: vi.fn(async () => ok(resultFixture)) } }
    );

    const preview = (
      await service.preview(context, {
        operation: 'field.convert',
        input: { tableId: 'tbl_a' },
        options: { includeComplexity: true },
      })
    )._unsafeUnwrap();

    expect(preview.outcome).toBe('incomplete');
    expect(preview.complexity).toEqual(resultFixture.assessment);
    expect(preview.complexity?.workload.rows).toEqual({
      status: 'unknown',
      expected: null,
      lower: null,
      upper: null,
    });
    expect(preview.complexity?.breakdown).toHaveProperty('modes');
    expect(preview.complexity).toMatchObject({
      policyVersion: expect.any(String),
      score: null,
      confidence: expect.any(String),
      reasonCodes: expect.any(Array),
      workload: { warnings: expect.any(Array) },
    });
    expect(preview.coverage.unknown).toEqual(
      expect.arrayContaining([
        'complexity-planner-projection',
        'complexity-selection',
        'complexity-authorized-dependency-scope',
        'complexity-statistics',
      ])
    );
    expect(preview.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'preview.complexity.planner_projection_unknown',
        'preview.complexity.authorization_scope_unknown',
        'preview.complexity.statistics_unknown',
      ])
    );
  });

  it('returns stable errors for unsupported operations and invalid operation input', async () => {
    const service = new OperationPreviewService(
      PreviewPlannerRegistry.create([registration()])._unsafeUnwrap()
    );

    const unsupported = await service.preview(context, {
      operation: 'base.duplicate' as const,
      input: {},
    });
    const invalid = await service.preview(context, {
      operation: 'field.convert',
      input: {},
    });

    expect(unsupported._unsafeUnwrapErr().code).toBe('preview.operation.unsupported');
    expect(invalid._unsafeUnwrapErr().code).toBe('preview.input.invalid');
  });

  it('rejects duplicate registrations and generates capabilities from the registry', () => {
    const duplicate = PreviewPlannerRegistry.create([registration(), registration()]);
    const registry = PreviewPlannerRegistry.create([registration()])._unsafeUnwrap();

    expect(duplicate._unsafeUnwrapErr().code).toBe('preview.operation.duplicate_registration');
    expect(registry.capabilities()).toEqual([
      {
        operation: 'field.convert',
        canonicalWriteRoute: 'PATCH /tables/:tableId/fields/:fieldId',
        supportLevel: 'full',
        requiredPermissionScope: 'field:update',
        detailLevels: ['summary', 'full'],
        limitations: [],
      },
    ]);
  });

  it('keeps host registration idempotent and deterministically prefers higher-ranked editions', async () => {
    const hostRegistration = (
      priority: number,
      plannerVersion: string
    ): HostPreviewRegistration<Record<string, never>> => ({
      operation: 'base.duplicate',
      priority,
      parseInput: () => ok({}),
      planner: {
        operation: 'base.duplicate',
        concerns: hostPreviewConcernValues,
        plannerVersion,
        executionPath: 'host',
        preview: async () => ok(readyPlan()),
      },
      capability: {
        canonicalWriteRoute: '/base/duplicate',
        supportLevel: 'partial',
        requiredPermissionScope: 'target base|create; source base|update',
        detailLevels: ['summary', 'full'],
        limitations: [],
      },
    });
    const registry = PreviewPlannerRegistry.empty();

    registry.registerHost(hostRegistration(0, 'ce-v1'))._unsafeUnwrap();
    registry.registerHost(hostRegistration(0, 'ce-duplicate'))._unsafeUnwrap();
    registry.registerHost(hostRegistration(100, 'ee-v1'))._unsafeUnwrap();
    registry.registerHost(hostRegistration(0, 'ce-late'))._unsafeUnwrap();

    const result = await new OperationPreviewService(registry).preview(context, {
      operation: 'base.duplicate',
      input: {},
    });
    expect(result._unsafeUnwrap().implementation.plannerVersion).toBe('ee-v1');
  });
});
