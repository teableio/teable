import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { TableCreated } from '../../domain/table/events/TableCreated';
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

@ProjectionHandler(TableCreated)
@injectable()
export class TableCreatedRealtimeProjection implements IEventHandler<TableCreated> {
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
    event: TableCreated
  ): Promise<Result<void, DomainError>> {
    const specResult = Table.specs(event.baseId).byId(event.tableId).build();
    if (specResult.isErr()) return err(specResult.error);

    const tableResult = await this.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) return err(tableResult.error);

    const snapshotResult = this.tableMapper.toDTO(tableResult.value);
    if (snapshotResult.isErr()) return err(snapshotResult.error);
    const snapshot = snapshotResult.value;

    const collection = `${tableCollectionPrefix}_${event.baseId.toString()}`;
    const docIdResult = RealtimeDocId.fromParts(collection, event.tableId.toString());
    if (docIdResult.isErr()) return err(docIdResult.error);

    const ensureTableResult = await this.realtimeEngine.ensure(
      context,
      docIdResult.value,
      snapshot
    );
    if (ensureTableResult.isErr()) return err(ensureTableResult.error);

    const fieldCollection = `${fieldCollectionPrefix}_${event.tableId.toString()}`;
    for (const field of snapshot.fields) {
      const fieldDocIdResult = RealtimeDocId.fromParts(fieldCollection, field.id);
      if (fieldDocIdResult.isErr()) return err(fieldDocIdResult.error);
      const ensureFieldResult = await this.realtimeEngine.ensure(
        context,
        fieldDocIdResult.value,
        field
      );
      if (ensureFieldResult.isErr()) return err(ensureFieldResult.error);
    }

    return ok(undefined);
  }
}
