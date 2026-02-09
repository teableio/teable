import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { FieldOptionsAdded } from '../../domain/table/events/FieldOptionsAdded';
import { Table } from '../../domain/table/Table';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';

const fieldCollectionPrefix = 'fld';

@ProjectionHandler(FieldOptionsAdded)
@injectable()
export class FieldOptionsAddedRealtimeProjection implements IEventHandler<FieldOptionsAdded> {
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
    event: FieldOptionsAdded
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;

    return safeTry(async function* () {
      // Fetch table data from repository
      const spec = yield* Table.specs(event.baseId).byId(event.tableId).build().safeUnwrap();
      const table = yield* (await tableRepository.findOne(context, spec)).safeUnwrap();
      const snapshot = yield* tableMapper.toDTO(table).safeUnwrap();

      // Find the field
      const fieldDto = snapshot.fields.find((field) => field.id === event.fieldId.toString());
      if (!fieldDto) {
        // Field not found - may have been deleted, skip silently
        return ok(undefined);
      }

      // Build the field document ID
      const fieldCollection = `${fieldCollectionPrefix}_${event.tableId.toString()}`;
      const fieldDocId = yield* RealtimeDocId.fromParts(
        fieldCollection,
        event.fieldId.toString()
      ).safeUnwrap();

      // Apply incremental change to update options
      return realtimeEngine.applyChange(context, fieldDocId, {
        type: 'set',
        path: ['options'],
        value: fieldDto.options,
      });
    });
  }
}
