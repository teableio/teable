import { inject, injectable } from '@teable/v2-di';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import { FieldCreated } from '../../domain/table/events/FieldCreated';
import type { IEventDispatchScope, IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';
import { loadRealtimeTableSnapshot } from './RealtimeTableSnapshotCache';
import {
  getRealtimeProjectionScope,
  scheduleRealtimeProjection,
} from './scheduleRealtimeProjection';

const tableCollectionPrefix = 'tbl';
const fieldCollectionPrefix = 'fld';

@ProjectionHandler(FieldCreated)
@injectable()
export class FieldCreatedRealtimeProjection implements IEventHandler<FieldCreated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: FieldCreated,
    dispatchScope?: IEventDispatchScope
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;

    return scheduleRealtimeProjection(
      context,
      FieldCreatedRealtimeProjection.name,
      (context, scope) =>
        safeTry(async function* () {
          const snapshot = yield* (
            await loadRealtimeTableSnapshot(context, {
              baseId: event.baseId,
              tableId: event.tableId,
              tableRepository,
              tableMapper,
              tableSnapshotCache: scope.tableSnapshotCache,
              isSnapshotUsable: (candidate) =>
                candidate.fields.some((field) => field.id === event.fieldId.toString()),
            })
          ).safeUnwrap();

          // Ensure table document exists (for tables created before realtime was enabled)
          const tableCollection = `${tableCollectionPrefix}_${event.baseId.toString()}`;
          const tableDocId = yield* RealtimeDocId.fromParts(
            tableCollection,
            event.tableId.toString()
          ).safeUnwrap();
          yield* (await realtimeEngine.ensure(context, tableDocId, snapshot)).safeUnwrap();

          // Create field document
          const fieldDto = snapshot.fields.find((field) => field.id === event.fieldId.toString());
          if (!fieldDto) {
            return err(
              domainError.validation({
                message: `Missing field snapshot for ${event.fieldId.toString()}`,
              })
            );
          }

          const fieldCollection = `${fieldCollectionPrefix}_${event.tableId.toString()}`;
          const fieldDocId = yield* RealtimeDocId.fromParts(
            fieldCollection,
            event.fieldId.toString()
          ).safeUnwrap();

          return realtimeEngine.ensure(context, fieldDocId, fieldDto);
        }),
      getRealtimeProjectionScope(dispatchScope)
    );
  }
}
