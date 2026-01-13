import { inject, injectable } from '@teable/v2-di';
import { err, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import { FieldCreated } from '../../domain/table/events/FieldCreated';
import { Table } from '../../domain/table/Table';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { ProjectionHandler } from './Projection';

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
    event: FieldCreated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, tableRepository, tableMapper } = this;

    return safeTry(async function* () {
      // Fetch table data from repository
      const spec = yield* Table.specs(event.baseId).byId(event.tableId).build().safeUnwrap();
      const table = yield* (await tableRepository.findOne(context, spec)).safeUnwrap();
      const snapshot = yield* tableMapper.toDTO(table).safeUnwrap();

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
    });
  }
}
