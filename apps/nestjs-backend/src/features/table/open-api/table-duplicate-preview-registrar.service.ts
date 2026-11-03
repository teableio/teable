import { Injectable } from '@nestjs/common';
import {
  PreviewPlannerRegistry,
  TableDuplicatePreviewPlanner,
  v2CommandExplainTokens,
  type HostPreviewRegistration,
  type IHostPreviewAdapter,
  type OperationPreviewPlan,
  type PreviewOptions,
} from '@teable/v2-command-explain';
import {
  DuplicateTableCommand,
  v2CoreTokens,
  type DomainError,
  type IDuplicateTablePreparationService,
  type IExecutionContext,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ok, type Result } from 'neverthrow';
import {
  V2ProjectionRegistrar,
  type IV2ProjectionRegistrar,
} from '../../v2/v2-projection-registrar';
import { TableOpenApiV2Service } from './table-open-api-v2.service';

const crossSpacePolicyCoverage = 'host.cross-space-reference-policy';
export class TableDuplicateHostPreviewPlanner implements IHostPreviewAdapter<DuplicateTableCommand> {
  readonly operation = 'table.duplicate' as const;
  readonly concerns = ['destination.placement'] as const;
  readonly plannerVersion = 'table-duplicate-host-v1';
  readonly executionPath = 'TableOpenApiV2Service.previewDuplicateTableV2Policy';

  constructor(
    private readonly corePlanner: TableDuplicatePreviewPlanner,
    private readonly tableService: TableOpenApiV2Service
  ) {}

  async preview(
    context: IExecutionContext,
    command: DuplicateTableCommand,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const core = await this.corePlanner.preview(context, command, options);
    if (core.isErr()) return core;

    const plan = core.value;
    let affectedFieldCount: number;
    try {
      ({ affectedFieldCount } = await this.tableService.previewDuplicateTableV2Policy(
        command.baseId.toString(),
        command.tableId.toString()
      ));
    } catch {
      return ok({
        ...plan,
        blockers: [
          ...plan.blockers,
          {
            code: 'table.duplicate.host_policy_blocked',
            message: 'Host migration or table duplication policy blocked this operation.',
          },
        ],
        coverage: {
          known: [...plan.coverage.known, 'host.table-duplicate-policy'],
          unknown: plan.coverage.unknown,
        },
      });
    }

    const warnings = plan.warnings.filter(
      ({ code }) => code !== 'table.duplicate.cross_space_policy_host_owned'
    );
    const unknown = plan.coverage.unknown.filter((item) => item !== 'cross-space-reference-policy');
    const effects = [...plan.effects];
    const blockers = [...plan.blockers];
    if (affectedFieldCount > 0) {
      effects.push({
        code: 'table.duplicate.link.cross_space_blocked',
        kind: 'dependency.change',
        measures: {
          fields: { basis: 'exact', value: affectedFieldCount, unit: 'fields' },
        },
      });
      blockers.push({
        code: 'table.duplicate.v2_cross_space_blocked',
        message: 'The selected v2 table-copy path rejects cross-space field references.',
      });
    }

    return ok({
      ...plan,
      effects,
      blockers,
      warnings,
      coverage: {
        known: [...plan.coverage.known, crossSpacePolicyCoverage],
        unknown,
      },
    });
  }
}

export const createTableDuplicateHostRegistration = (
  planner: TableDuplicateHostPreviewPlanner
): HostPreviewRegistration<DuplicateTableCommand> => ({
  operation: 'table.duplicate',
  parseInput: DuplicateTableCommand.create,
  planner,
  priority: 10,
  capability: {
    canonicalWriteRoute: 'POST /base/{baseId}/table/{tableId}/duplicate',
    supportLevel: 'partial',
    requiredPermissionScope: 'table:create,table:read',
    detailLevels: ['summary', 'full'],
    limitations: [
      'The selected v2 path blocks rather than converts cross-space field references.',
      'Execution-only table operation plugins are not run during preview.',
      'Final physical row-copy applicability and source row count are unavailable before persistence.',
    ],
  },
});

@V2ProjectionRegistrar()
@Injectable()
export class TableDuplicatePreviewRegistrar implements IV2ProjectionRegistrar {
  constructor(private readonly tableService: TableOpenApiV2Service) {}

  registerProjections(container: DependencyContainer): void {
    const preparation = container.resolve<IDuplicateTablePreparationService>(
      v2CoreTokens.duplicateTablePreparationService
    );
    const registry = container.resolve<PreviewPlannerRegistry>(
      v2CommandExplainTokens.previewPlannerRegistry
    );
    const result = registry.registerHost(
      createTableDuplicateHostRegistration(
        new TableDuplicateHostPreviewPlanner(
          new TableDuplicatePreviewPlanner(preparation),
          this.tableService
        )
      )
    );
    if (result.isErr()) throw new Error(result.error.message);
  }
}
