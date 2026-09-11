import {
  FieldDeleted,
  FieldUpdated,
  ProjectionHandler,
  Table,
  v2CoreTokens,
  type IEventHandler,
  type IExecutionContext,
  type ILogger,
  type ITableRepository,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';

import type {
  TableSearchVectorSchemaMaintenanceReason,
  TableSearchVectorSchemaMaintenanceScheduler,
} from './ports';
import { v2TableOpsTokens } from './tokens';

// Adding a field does not invalidate an existing generated document. Its
// covered field IDs remain the table's search contract until an administrator
// explicitly rebuilds the access path to include new eligible fields.
type SearchVectorSchemaEvent = FieldUpdated | FieldDeleted;

@ProjectionHandler(FieldUpdated)
@ProjectionHandler(FieldDeleted)
@injectable()
export class TableSearchVectorSchemaMaintenanceProjection
  implements IEventHandler<SearchVectorSchemaEvent>
{
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler)
    private readonly scheduler: TableSearchVectorSchemaMaintenanceScheduler,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async handle(context: IExecutionContext, event: SearchVectorSchemaEvent) {
    const { tableRepository, scheduler } = this;
    const scheduled = await safeTry(async function* () {
      const spec = yield* Table.specs(event.baseId).byId(event.tableId).build().safeUnwrap();
      const table = yield* (await tableRepository.findOne(context, spec)).safeUnwrap();
      yield* (
        await scheduler.schedule(context, {
          table,
          reason: maintenanceReason(event),
        })
      ).safeUnwrap();
      return ok(undefined);
    });
    if (scheduled.isErr()) {
      this.logger.warn('Failed to schedule search vector maintenance after field schema change', {
        tableId: event.tableId.toString(),
        fieldId: event.fieldId.toString(),
        error: scheduled.error.message,
      });
    }
    return ok(undefined);
  }
}

const maintenanceReason = (
  event: SearchVectorSchemaEvent
): TableSearchVectorSchemaMaintenanceReason => {
  if (event instanceof FieldUpdated) return 'field_updated';
  return 'field_deleted';
};
