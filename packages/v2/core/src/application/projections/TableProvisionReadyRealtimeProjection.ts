import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { TableProvisionReady } from '../../domain/table/events/TableProvisionReady';
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

// Pending tables are excluded from table-list queries. Re-ensure the table when
// provisioning completes; its field documents were never removed.
@ProjectionHandler(TableProvisionReady)
@injectable()
export class TableProvisionReadyRealtimeProjection implements IEventHandler<TableProvisionReady> {
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
    event: TableProvisionReady
  ): Promise<Result<void, DomainError>> {
    const { tableRepository, tableMapper, realtimeEngine } = this;

    return safeTry(async function* () {
      const spec = yield* Table.specs(event.baseId).byId(event.tableId).build().safeUnwrap();
      const table = yield* (await tableRepository.findOne(context, spec)).safeUnwrap();
      const snapshot = yield* tableMapper.toDTO(table).safeUnwrap();
      const docId = yield* RealtimeDocId.fromParts(
        `${tableCollectionPrefix}_${event.baseId.toString()}`,
        event.tableId.toString()
      ).safeUnwrap();
      yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();

      return ok(undefined);
    });
  }
}
