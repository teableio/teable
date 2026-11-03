import {
  PreviewPlannerRegistry,
  type OperationPreviewPlan,
  type TableDuplicatePreviewPlanner,
  v2CommandExplainTokens,
} from '@teable/v2-command-explain';
import {
  DuplicateTableCommand,
  domainError,
  v2CoreTokens,
  type IExecutionContext,
} from '@teable/v2-core';
import { createChildContainer } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  createTableDuplicateHostRegistration,
  TableDuplicateHostPreviewPlanner,
  TableDuplicatePreviewRegistrar,
} from './table-duplicate-preview-registrar.service';
import type { TableOpenApiV2Service } from './table-open-api-v2.service';

const context = {} as IExecutionContext;
const options = { detail: 'summary' as const, includeComplexity: false, maxItems: 100 };
const baseId = `bse${'s'.repeat(16)}`;
const tableId = `tbl${'s'.repeat(16)}`;
const command = DuplicateTableCommand.create({
  baseId,
  tableId,
  name: 'Copy',
  includeRecords: true,
})._unsafeUnwrap();

const corePlan = (): OperationPreviewPlan => ({
  effects: [],
  blockers: [],
  warnings: [{ code: 'table.duplicate.cross_space_policy_host_owned' }],
  coverage: {
    known: ['same-base-aggregate-duplication'],
    unknown: ['cross-space-reference-policy', 'source-record-count'],
  },
  complexity: null,
  authorization: 'not-applicable',
  consistency: 'best-effort',
});

const planner = (affectedFieldCount: number) => {
  const core = {
    preview: vi.fn().mockResolvedValue(ok(corePlan())),
  } as unknown as TableDuplicatePreviewPlanner;
  const tableService = {
    previewDuplicateTableV2Policy: vi.fn().mockResolvedValue({ affectedFieldCount }),
  } as unknown as TableOpenApiV2Service;
  return {
    planner: new TableDuplicateHostPreviewPlanner(core, tableService),
    tableService,
  };
};

describe('TableDuplicateHostPreviewPlanner', () => {
  it('reports the selected v2 cross-space blocker instead of legacy conversion wording', async () => {
    const fixture = planner(2);
    const result = await fixture.planner.preview(context, command, options);
    const plan = result._unsafeUnwrap();

    expect(fixture.tableService.previewDuplicateTableV2Policy).toHaveBeenCalledWith(
      baseId,
      tableId
    );
    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: 'table.duplicate.v2_cross_space_blocked' }),
    ]);
    expect(plan.effects).toContainEqual(
      expect.objectContaining({
        code: 'table.duplicate.link.cross_space_blocked',
        measures: { fields: { basis: 'exact', value: 2, unit: 'fields' } },
      })
    );
    expect(plan.warnings.map(({ code }) => code)).not.toContain(
      'table.duplicate.cross_space_policy_host_owned'
    );
    expect(plan.coverage.unknown).not.toContain('cross-space-reference-policy');
    expect(plan.coverage.known).toContain('host.cross-space-reference-policy');
  });

  it('registers as a ranked host replacement for the core table planner', () => {
    const fixture = planner(0);
    const registry = PreviewPlannerRegistry.empty();
    const coreRegistration = {
      operation: 'table.duplicate' as const,
      parseInput: DuplicateTableCommand.create,
      planner: {
        operation: 'table.duplicate' as const,
        plannerVersion: 'core-v1',
        executionPath: 'core',
        preview: vi.fn().mockResolvedValue(ok(corePlan())),
      },
      capability: {
        canonicalWriteRoute: 'core',
        supportLevel: 'partial' as const,
        requiredPermissionScope: 'table:read',
        detailLevels: ['summary' as const],
        limitations: [],
      },
    };

    registry.register(coreRegistration)._unsafeUnwrap();
    registry.registerHost(createTableDuplicateHostRegistration(fixture.planner))._unsafeUnwrap();

    expect(registry.resolve('table.duplicate')._unsafeUnwrap().plannerVersion).toBe(
      'table-duplicate-host-v1'
    );
    expect(
      registry.capabilities().find(({ operation }) => operation === 'table.duplicate')
    ).toEqual(
      expect.objectContaining({
        canonicalWriteRoute: 'POST /base/{baseId}/table/{tableId}/duplicate',
      })
    );
  });

  it('uses host-registered core preparation before checking the host copy policy', async () => {
    const container = createChildContainer();
    const rejection = domainError.forbidden({
      code: 'host.table_duplicate.denied',
      message: 'Host preparation denied table duplication',
    });
    const prepare = vi.fn(async () => err(rejection));
    const tableService = {
      previewDuplicateTableV2Policy: vi.fn(),
    } as unknown as TableOpenApiV2Service;
    const registry = PreviewPlannerRegistry.empty();
    container.registerInstance(v2CoreTokens.duplicateTablePreparationService, { prepare });
    container.registerInstance(v2CommandExplainTokens.previewPlannerRegistry, registry);
    new TableDuplicatePreviewRegistrar(tableService).registerProjections(container);

    const result = await registry
      .resolve('table.duplicate')
      ._unsafeUnwrap()
      .plan(context, { baseId, tableId, name: 'Copy', includeRecords: true }, options);

    expect(result._unsafeUnwrapErr()).toBe(rejection);
    expect(prepare).toHaveBeenCalledOnce();
    expect(tableService.previewDuplicateTableV2Policy).not.toHaveBeenCalled();
  });
});
