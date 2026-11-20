import { Injectable } from '@nestjs/common';
import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  v2CoreTokens,
  viewSnapshotSchema,
  type DomainError,
  type IExecutionContext,
  type IViewTrashSnapshotReader,
  type TableId,
  type ViewId,
  type ViewSnapshotValue,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { err, ok, type Result } from 'neverthrow';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

class ViewTrashSnapshotReader implements IViewTrashSnapshotReader {
  async get(
    context: IExecutionContext,
    tableId: TableId,
    viewId: ViewId
  ): Promise<Result<ViewSnapshotValue, DomainError>> {
    const db = getPostgresTransaction<V1TeableDatabase>(context, 'meta');
    if (!db) {
      return err(
        domainError.invariant({ message: 'View trash restore requires a metadata transaction' })
      );
    }
    const row = await db
      .selectFrom('view')
      .selectAll()
      .where('table_id', '=', tableId.toString())
      .where('id', '=', viewId.toString())
      .forUpdate()
      .executeTakeFirst();
    if (!row) {
      return err(domainError.notFound({ code: 'view.not_found', message: 'View not found' }));
    }
    if (!row.deleted_time) {
      return err(
        domainError.conflict({ code: 'view.already_exists', message: 'View already exists' })
      );
    }
    let raw: unknown;
    try {
      const sort = row.sort ? JSON.parse(row.sort) : undefined;
      raw = {
        id: row.id,
        name: row.name,
        type: row.type,
        order: row.order,
        properties: {
          description: row.description ?? undefined,
          isLocked: row.is_locked ?? undefined,
          enableShare: row.enable_share ?? undefined,
          shareId: row.share_id ?? undefined,
          shareMeta: row.share_meta ? JSON.parse(row.share_meta) : undefined,
        },
        columnMeta: JSON.parse(row.column_meta),
        query: {
          sort: sort?.sortObjs,
          manualSort: sort?.manualSort,
          group: row.group ? JSON.parse(row.group) : undefined,
        },
        sourceFilter: row.filter ? JSON.parse(row.filter) : undefined,
        options: row.options ? JSON.parse(row.options) : undefined,
      };
    } catch (error) {
      return err(
        domainError.unexpected({
          message: 'Invalid retained View trash snapshot',
          details: { cause: error instanceof Error ? error.message : String(error) },
        })
      );
    }
    const parsed = viewSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.unexpected({
          message: 'Invalid retained View trash snapshot',
          details: { issues: parsed.error.issues },
        })
      );
    }
    return ok(parsed.data as ViewSnapshotValue);
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2ViewTrashSnapshotService implements IV2ProjectionRegistrar {
  registerProjections(container: DependencyContainer): void {
    container.registerInstance(v2CoreTokens.viewTrashSnapshotReader, new ViewTrashSnapshotReader());
  }
}
