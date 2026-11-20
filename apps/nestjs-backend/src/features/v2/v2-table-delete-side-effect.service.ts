/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import {
  resolvePostgresDbOrTx,
  v2DataDbTokens,
  v2MetaDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import {
  SameTxProjectionHandler,
  TableDeleted,
  domainError,
  err,
  ok,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { sql, type Kysely, type SqlBool } from 'kysely';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

export type IV2TableDeleteSideEffectDb = {
  field: {
    id: string;
    table_id: string;
  };
  task_reference: {
    from_field_id: string;
    to_field_id: string;
  };
  task: {
    snapshot: string | null;
  };
  comment: {
    table_id: string;
  };
  comment_subscription: {
    table_id: string;
  };
  attachments_table: {
    table_id: string;
  };
  ops: {
    collection: string;
    doc_id: string;
  };
  record_history: {
    table_id: string;
  };
  table_trash: {
    table_id: string;
  };
  record_trash: {
    table_id: string;
  };
};

type SidecarRelationProbeRow = {
  attachments_table: string | null;
  record_history: string | null;
  table_trash: string | null;
  record_trash: string | null;
};

type SidecarRelationName = 'attachments_table' | 'record_history' | 'table_trash' | 'record_trash';

const resolveRelationName = (
  db: Kysely<IV2TableDeleteSideEffectDb>,
  name: SidecarRelationName
): string => db.selectFrom(name).selectAll().compile().sql.slice('select * from '.length);

/**
 * Cleans host metadata and sidecar rows inside DeleteTableHandler's active
 * transaction so failed cleanup aborts the purge before tableMeta/field vanish.
 */
@SameTxProjectionHandler(TableDeleted, {
  id: 'teable.host.table-delete.side-effects',
})
export class V2TableDeletedResourceCleanupProjection implements IEventHandler<TableDeleted> {
  constructor(
    private readonly metaDb: Kysely<IV2TableDeleteSideEffectDb>,
    private readonly dataDb: Kysely<IV2TableDeleteSideEffectDb>
  ) {}

  async handle(
    context: IExecutionContext,
    event: TableDeleted
  ): Promise<Result<void, DomainError>> {
    try {
      const metaTx = resolvePostgresDbOrTx(this.metaDb, context, 'meta');
      const dataTx = resolvePostgresDbOrTx(this.dataDb, context, 'data');
      const baseId = event.baseId.toString();
      const tableId = event.tableId.toString();
      const fieldIds = event.fieldIds.map((id) => id.toString());

      // Query field rows directly in metaTx as well as event.fieldIds so
      // previously soft-deleted or pending fields do not orphan task_reference rows.
      const tableFieldIds = metaTx.selectFrom('field').select('id').where('table_id', '=', tableId);
      await metaTx
        .deleteFrom('task_reference')
        .where((eb) =>
          eb.or([
            eb('from_field_id', 'in', tableFieldIds),
            eb('to_field_id', 'in', tableFieldIds),
            ...(fieldIds.length > 0
              ? [eb('from_field_id', 'in', fieldIds), eb('to_field_id', 'in', fieldIds)]
              : []),
          ])
        )
        .execute();

      const snapshotMarker = `"tableId":"${tableId}"`;
      await metaTx
        .deleteFrom('task')
        .where(sql<SqlBool>`strpos("snapshot", ${snapshotMarker}) > 0`)
        .execute();

      await metaTx.deleteFrom('comment').where('table_id', '=', tableId).execute();
      await metaTx.deleteFrom('comment_subscription').where('table_id', '=', tableId).execute();
      await metaTx.deleteFrom('attachments_table').where('table_id', '=', tableId).execute();
      await metaTx.deleteFrom('ops').where('collection', '=', tableId).execute();
      await metaTx
        .deleteFrom('ops')
        .where('collection', '=', baseId)
        .where('doc_id', '=', tableId)
        .execute();

      // Sidecar tables may live in the base's routed data DB (or not be initialized on test DBs).
      const attachmentsRelation = resolveRelationName(this.dataDb, 'attachments_table');
      const recordHistoryRelation = resolveRelationName(this.dataDb, 'record_history');
      const tableTrashRelation = resolveRelationName(this.dataDb, 'table_trash');
      const recordTrashRelation = resolveRelationName(this.dataDb, 'record_trash');
      const probe = await sql<SidecarRelationProbeRow>`
        SELECT
          to_regclass(${attachmentsRelation})::text AS attachments_table,
          to_regclass(${recordHistoryRelation})::text AS record_history,
          to_regclass(${tableTrashRelation})::text AS table_trash,
          to_regclass(${recordTrashRelation})::text AS record_trash
      `.execute(dataTx);
      const relations = probe.rows[0];

      if (dataTx !== metaTx && relations?.attachments_table) {
        await dataTx.deleteFrom('attachments_table').where('table_id', '=', tableId).execute();
      }
      if (relations?.record_history) {
        await dataTx.deleteFrom('record_history').where('table_id', '=', tableId).execute();
      }
      if (relations?.table_trash) {
        await dataTx.deleteFrom('table_trash').where('table_id', '=', tableId).execute();
      }
      if (relations?.record_trash) {
        await dataTx.deleteFrom('record_trash').where('table_id', '=', tableId).execute();
      }

      return ok(undefined);
    } catch (error) {
      return err(domainError.fromUnknown(error));
    }
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2TableDeleteSideEffectService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2TableDeleteSideEffectService.name);

  registerProjections(container: DependencyContainer): void {
    this.logger.debug('Registering V2 Table delete resource cleanup projection');
    const metaDb = container.resolve<Kysely<IV2TableDeleteSideEffectDb>>(v2MetaDbTokens.db);
    const dataDb = container.resolve<Kysely<IV2TableDeleteSideEffectDb>>(v2DataDbTokens.db);
    container.registerInstance(
      V2TableDeletedResourceCleanupProjection,
      new V2TableDeletedResourceCleanupProjection(metaDb, dataDb)
    );
  }
}
