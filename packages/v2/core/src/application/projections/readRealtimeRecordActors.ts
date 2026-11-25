import { err, ok, safeTry } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import { domainError } from '../../domain/shared/DomainError';
import { RecordId } from '../../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { ITableRepository } from '../../ports/TableRepository';
import type { ITableRecordRealtimeDTO } from './TableRecordRealtimeDTO';

/** Read only physical system actors for exact IDs already authorized by the successful mutation. */
export const readRealtimeRecordActors = (
  context: IExecutionContext,
  baseId: BaseId,
  tableId: TableId,
  recordIds: ReadonlyArray<string>,
  tables: ITableRepository,
  records: ITableRecordQueryRepository
) =>
  safeTry(async function* () {
    const ids: RecordId[] = [];
    for (const id of recordIds) ids.push(yield* RecordId.create(id));
    const committedTable = context.getCommittedTable?.(tableId.toString());
    // The write already supplied its lease-protected table. Reuse it only for this
    // committed projection scope and exact base/table; other deliveries still load
    // activeWithPending metadata before the owning schema operation publishes ready.
    let table: Table;
    if (
      committedTable instanceof Table &&
      committedTable.id().equals(tableId) &&
      committedTable.baseId().equals(baseId)
    ) {
      table = committedTable;
    } else {
      const spec = yield* Table.specs(baseId).byId(tableId).build();
      table = yield* await tables.findOne(context, spec, { state: 'activeWithPending' });
    }
    const result = yield* await records.find(context, table, RecordByIdsSpec.create(ids), {
      mode: 'stored',
      projectionFieldIds: [],
      includeTotal: false,
    });
    const actors = new Map<
      string,
      {
        version: number;
        actors: Pick<
          ITableRecordRealtimeDTO,
          | 'createdByActorType'
          | 'createdByActorId'
          | 'lastModifiedByActorType'
          | 'lastModifiedByActorId'
        >;
      }
    >();
    for (const row of result.records) {
      actors.set(row.id, {
        version: row.version,
        actors: {
          createdByActorType: row.createdByActorType,
          createdByActorId: row.createdByActorId,
          lastModifiedByActorType: row.lastModifiedByActorType,
          lastModifiedByActorId: row.lastModifiedByActorId,
        },
      });
    }
    for (const id of recordIds) {
      if (!actors.has(id))
        return err(
          domainError.notFound({ code: 'record.not_found', message: `Record not found: ${id}` })
        );
    }
    return ok(actors);
  });
