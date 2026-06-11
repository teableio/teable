import type {
  DomainError,
  ILogger,
  ITableRepository,
  TableId,
  FieldId,
  IExecutionContext,
} from '@teable/v2-core';
import { TableByIdSpec, v2CoreTokens } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { ComputedFieldCascadeAfterSchemaUpdate } from './ComputedFieldCascadeAfterSchemaUpdate';
import type { ComputedUpdatePlanner } from './ComputedUpdatePlanner';

/**
 * Adapter-side implementation for recomputing stored computed fields after an out-of-band value
 * patch. We use this for user rename, where denormalized user snapshots are updated in SQL and the
 * downstream lookup/formula/rollup closure must be recomputed without going through record writes.
 */
@injectable()
export class ExternalComputedRefreshService {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2RecordRepositoryPostgresTokens.computedFieldCascadeService)
    private readonly cascadeService: ComputedFieldCascadeAfterSchemaUpdate,
    @inject(v2RecordRepositoryPostgresTokens.computedUpdatePlanner)
    private readonly computedUpdatePlanner: ComputedUpdatePlanner,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async refreshAfterExternalValueChanges(
    context: IExecutionContext,
    input: {
      changes: ReadonlyArray<{
        tableId: TableId;
        fieldIds: ReadonlyArray<FieldId>;
      }>;
    }
  ): Promise<Result<void, DomainError>> {
    if (input.changes.length === 0) return ok(undefined);

    const pendingFieldIdsByTable = new Map<string, { tableId: TableId; fieldIds: Set<FieldId> }>();
    const processedFieldKeys = new Set<string>();

    const enqueueFields = (tableId: TableId, fieldIds: Iterable<FieldId>): void => {
      const key = tableId.toString();
      const pending = pendingFieldIdsByTable.get(key) ?? {
        tableId,
        fieldIds: new Set<FieldId>(),
      };
      for (const fieldId of fieldIds) {
        if (processedFieldKeys.has(`${key}:${fieldId.toString()}`)) continue;
        pending.fieldIds.add(fieldId);
      }
      if (pending.fieldIds.size > 0) {
        pendingFieldIdsByTable.set(key, pending);
      }
    };

    for (const change of input.changes) {
      enqueueFields(change.tableId, change.fieldIds);
    }

    this.logger.info('Refreshing computed dependencies after external value changes', {
      tableCount: pendingFieldIdsByTable.size,
    });

    // `cascade(...)` recomputes the current seed set, and the planner tells us which stored
    // computed fields became newly stale. Feed those planned fields back into the same loop until
    // the dependency closure is exhausted.
    while (pendingFieldIdsByTable.size > 0) {
      const nextEntry = pendingFieldIdsByTable.entries().next().value as
        | [string, { tableId: TableId; fieldIds: Set<FieldId> }]
        | undefined;
      if (!nextEntry) break;

      const [tableKey, pending] = nextEntry;
      pendingFieldIdsByTable.delete(tableKey);

      const pendingFieldIds = Array.from(pending.fieldIds).filter((fieldId) => {
        const fieldKey = `${tableKey}:${fieldId.toString()}`;
        if (processedFieldKeys.has(fieldKey)) return false;
        processedFieldKeys.add(fieldKey);
        return true;
      });
      if (pendingFieldIds.length === 0) continue;

      try {
        const tableResult = await this.tableRepository.findOne(
          context,
          TableByIdSpec.create(pending.tableId)
        );
        if (tableResult.isErr()) {
          this.logger.error(tableResult.error.message, {
            tableId: pending.tableId.toString(),
          });
          continue;
        }

        const table = tableResult.value;
        const planResult = await this.computedUpdatePlanner.plan(
          {
            table,
            changedFieldIds: pendingFieldIds,
            changedRecordIds: [],
            changeType: 'update',
            cyclePolicy: 'skip',
          },
          context
        );
        if (planResult.isErr()) {
          this.logger.error(planResult.error.message, {
            tableId: pending.tableId.toString(),
          });
        }

        const cascadeResult = await this.cascadeService.cascade(context, {
          table,
          selfBackfillFieldIds: [],
          valueChangedFieldIds: pendingFieldIds,
        });
        if (cascadeResult.isErr()) {
          this.logger.error(cascadeResult.error.message, {
            tableId: pending.tableId.toString(),
          });
          continue;
        }

        if (planResult.isOk()) {
          for (const step of planResult.value.steps) {
            enqueueFields(step.tableId, step.fieldIds);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(message, {
          tableId: pending.tableId.toString(),
        });
      }
    }

    return ok(undefined);
  }
}
