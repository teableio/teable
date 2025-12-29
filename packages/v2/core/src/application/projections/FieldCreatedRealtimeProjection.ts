import { inject, injectable } from '@teable/v2-di';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

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

const fieldCollectionPrefix = 'fld';

@ProjectionHandler(FieldCreated)
@injectable()
export class FieldCreatedRealtimeProjection implements IEventHandler<FieldCreated> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper,
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: FieldCreated
  ): Promise<Result<void, string>> {
    const specResult = Table.specs(event.baseId).byId(event.tableId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) return err(tableResult.error);

    const dtoResult = this.tableMapper.toDTO(tableResult.value);
    if (dtoResult.isErr()) return err(dtoResult.error);

    const fieldDto = dtoResult.value.fields.find((field) => field.id === event.fieldId.toString());
    if (!fieldDto) return err(`Missing field snapshot for ${event.fieldId.toString()}`);

    const collection = `${fieldCollectionPrefix}_${event.tableId.toString()}`;
    const docIdResult = RealtimeDocId.fromParts(collection, event.fieldId.toString());
    if (docIdResult.isErr()) return err(docIdResult.error);

    return this.realtimeEngine.ensure(context, docIdResult.value, fieldDto);
  }
}
