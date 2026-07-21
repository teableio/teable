import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  ComputedActivityBatchChanged,
  isComputedActivityBatchChangedEvent,
} from '../../domain/computed/events/ComputedActivityBatchChanged';
import {
  getFieldComputeBatchProgress,
  type FieldComputeMetaDto,
} from '../../domain/computed/FieldComputeMeta';
import type { TableComputeMetaDto } from '../../domain/computed/TableComputeMeta';
import type { DomainError } from '../../domain/shared/DomainError';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';

const computeCollectionPrefix = 'cmp';

export const mapTableComputeActivityToRealtime = (table: TableComputeMetaDto) => ({
  status: table.status,
  calculatingFieldCount: table.calculatingFieldCount,
  queuedFieldCount: table.queuedFieldCount,
  estimatedComplexity: table.estimatedComplexity,
  recentCompletions: table.recentCompletions,
  generation: table.generation,
  computeMode: 'server' as const,
  updatedAt: table.updatedAt,
});

export const mapFieldComputeActivityToRealtime = (field: FieldComputeMetaDto) => ({
  fieldId: field.fieldId,
  status: field.status,
  estimatedComplexity: field.estimatedComplexity,
  estimatedDirtyRecords: field.estimatedDirtyRecords,
  generation: field.generation,
  startedAt: field.startedAt,
  lastDurationMs: field.lastDurationMs,
  lastError: field.lastError,
  updatedAt: field.updatedAt,
  activeTaskCount: field.activeTaskCount,
  processingTaskCount: field.processingTaskCount,
  batchProgress: getFieldComputeBatchProgress(field),
});

/**
 * Projects compute-activity changes onto ShareDB collection `cmp_{tableId}`.
 * Doc ids:
 * - `table` — table-level computeMeta summary
 * - `{fieldId}` — field-level computeMeta
 */
@ProjectionHandler(ComputedActivityBatchChanged)
@injectable()
export class ComputedActivityRealtimeProjection
  implements IEventHandler<ComputedActivityBatchChanged>
{
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: ComputedActivityBatchChanged
  ): Promise<Result<void, DomainError>> {
    if (!isComputedActivityBatchChangedEvent(event)) {
      return ok(undefined);
    }

    const { realtimeEngine } = this;

    return safeTry(async function* () {
      const tablesById = new Map(event.tables.map((table) => [table.tableId, table]));
      const fieldsByTable = new Map<string, Array<(typeof event.fields)[number]>>();

      for (const field of event.fields) {
        const list = fieldsByTable.get(field.tableId) ?? [];
        list.push(field);
        fieldsByTable.set(field.tableId, list);
      }

      const tableIds = new Set<string>([...tablesById.keys(), ...fieldsByTable.keys()]);

      for (const tableId of tableIds) {
        const collection = `${computeCollectionPrefix}_${tableId}`;
        const tableMeta = tablesById.get(tableId);
        if (tableMeta) {
          const tableDocId = yield* RealtimeDocId.fromParts(collection, 'table').safeUnwrap();
          const publicTable = mapTableComputeActivityToRealtime(tableMeta);
          const result =
            tableMeta.generation <= 1
              ? await realtimeEngine.ensure(context, tableDocId, publicTable)
              : await realtimeEngine.applyChange(
                  context,
                  tableDocId,
                  { type: 'set', path: [], value: publicTable },
                  { version: tableMeta.generation - 1 }
                );
          yield* result.safeUnwrap();
        }

        for (const field of fieldsByTable.get(tableId) ?? []) {
          const fieldDocId = yield* RealtimeDocId.fromParts(collection, field.fieldId).safeUnwrap();
          const publicField = mapFieldComputeActivityToRealtime(field);
          const result =
            field.generation <= 1
              ? await realtimeEngine.ensure(context, fieldDocId, publicField)
              : await realtimeEngine.applyChange(
                  context,
                  fieldDocId,
                  { type: 'set', path: [], value: publicField },
                  { version: field.generation - 1 }
                );
          yield* result.safeUnwrap();
        }
      }

      return ok(undefined);
    });
  }
}
