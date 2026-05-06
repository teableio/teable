import { Injectable, Logger } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import { generateOperationId } from '@teable/core';
import { ResourceType } from '@teable/openapi';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ProjectionHandler,
  RecordsDeleted,
  TableRestored,
  TableTrashed,
  ok,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { nanoid } from 'nanoid';
import type { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import { V2RecordTrashService } from './v2-record-trash.service';

/* eslint-disable @typescript-eslint/naming-convention */
type IAttachmentsTableDb = V1TeableDatabase & {
  attachments_table: {
    table_id: string;
    record_id: string;
  };
  table_meta: {
    id: string;
    base_id: string;
    deleted_time: Date | null;
  };
  trash: {
    id: string;
    resource_id: string;
    resource_type: string;
    parent_id: string | null;
    deleted_time: Date;
    deleted_by: string;
  };
};
/* eslint-enable @typescript-eslint/naming-convention */

@ProjectionHandler(RecordsDeleted)
export class V2RecordsDeletedTableTrashProjection implements IEventHandler<RecordsDeleted> {
  constructor(private readonly v2RecordTrashService: V2RecordTrashService) {}

  async handle(
    context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    if (event.recordSnapshots.length === 0) {
      return ok(undefined);
    }

    const buildPayloadAttributes = {
      teableTableId: event.tableId.toString(),
      teableRecordCount: event.recordSnapshots.length,
    } satisfies Record<string, string | number | boolean>;

    const records = await this.runInSpan(
      context,
      'teable.V2RecordsDeletedTableTrashProjection.buildTrashPayload',
      buildPayloadAttributes,
      async () =>
        event.recordSnapshots.map((snapshot) => {
          const record: IDeleteRecordsPayload['records'][number] = {
            id: snapshot.id,
            fields: snapshot.fields as IRecord['fields'],
            autoNumber: snapshot.autoNumber,
            createdTime: snapshot.createdTime,
            createdBy: snapshot.createdBy,
            lastModifiedTime: snapshot.lastModifiedTime,
            lastModifiedBy: snapshot.lastModifiedBy,
            order: snapshot.orders,
          };

          if (snapshot.displayName) {
            record.name = snapshot.displayName;
          }

          return record;
        })
    );

    const persistAttributes = {
      teableTableId: event.tableId.toString(),
      teableRecordCount: records.length,
    } satisfies Record<string, string | number | boolean>;

    await this.runInSpan(
      context,
      'teable.V2RecordsDeletedTableTrashProjection.persistDeletedRecords',
      persistAttributes,
      async () =>
        this.v2RecordTrashService.persistDeletedRecords(
          {
            operationId: generateOperationId(),
            windowId: context.windowId,
            tableId: event.tableId.toString(),
            userId: context.actorId.toString(),
            records,
          },
          context
        )
    );

    return ok(undefined);
  }

  private async runInSpan<T>(
    context: IExecutionContext,
    name: `teable.${string}`,
    attributes: Record<string, string | number | boolean>,
    callback: () => Promise<T>
  ): Promise<T> {
    const tracer = context.tracer;
    const spanAttributes: Record<string, string | number | boolean> = {
      teableVersion: 'v2',
      teableComponent: 'projection',
      teableOperation: name.replace(/^teable\./, ''),
      ...attributes,
    };
    const span = tracer?.startSpan(name, spanAttributes);

    if (!tracer || !span) {
      return callback();
    }

    return tracer.withSpan(span, async () => {
      try {
        return await callback();
      } finally {
        span.end();
      }
    });
  }
}

@ProjectionHandler(RecordsDeleted)
export class V2RecordsDeletedAttachmentProjection implements IEventHandler<RecordsDeleted> {
  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    if (event.recordIds.length === 0) {
      return ok(undefined);
    }

    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve<Kysely<IAttachmentsTableDb>>(v2MetaDbTokens.db);

    await db
      .deleteFrom('attachments_table')
      .where('table_id', '=', event.tableId.toString())
      .where(
        'record_id',
        'in',
        event.recordIds.map((id) => id.toString())
      )
      .execute();

    return ok(undefined);
  }
}

@ProjectionHandler(TableTrashed)
export class V2TableTrashedProjection implements IEventHandler<TableTrashed> {
  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async handle(
    context: IExecutionContext,
    event: TableTrashed
  ): Promise<Result<void, DomainError>> {
    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve<Kysely<IAttachmentsTableDb>>(v2MetaDbTokens.db);
    const table = await db
      .selectFrom('table_meta')
      .where('id', '=', event.tableId.toString())
      .select(['base_id', 'deleted_time'])
      .executeTakeFirst();

    if (!table?.deleted_time) {
      return ok(undefined);
    }

    await db
      .deleteFrom('trash')
      .where('resource_id', '=', event.tableId.toString())
      .where('resource_type', '=', ResourceType.Table)
      .execute();

    await db
      .insertInto('trash')
      .values({
        id: nanoid(),
        resource_id: event.tableId.toString(),
        resource_type: ResourceType.Table,
        parent_id: table.base_id,
        deleted_time: table.deleted_time,
        deleted_by: context.actorId.toString(),
      })
      .execute();

    return ok(undefined);
  }
}

@ProjectionHandler(TableRestored)
export class V2TableRestoredProjection implements IEventHandler<TableRestored> {
  constructor(private readonly v2ContainerService: V2ContainerService) {}

  async handle(
    _context: IExecutionContext,
    event: TableRestored
  ): Promise<Result<void, DomainError>> {
    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve<Kysely<IAttachmentsTableDb>>(v2MetaDbTokens.db);
    await db
      .deleteFrom('trash')
      .where('resource_id', '=', event.tableId.toString())
      .where('resource_type', '=', ResourceType.Table)
      .execute();

    return ok(undefined);
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2TableTrashService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2TableTrashService.name);

  constructor(
    private readonly v2RecordTrashService: V2RecordTrashService,
    private readonly v2ContainerService: V2ContainerService
  ) {}

  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 trash projections');

    container.registerInstance(
      V2RecordsDeletedTableTrashProjection,
      new V2RecordsDeletedTableTrashProjection(this.v2RecordTrashService)
    );

    container.registerInstance(
      V2RecordsDeletedAttachmentProjection,
      new V2RecordsDeletedAttachmentProjection(this.v2ContainerService)
    );
    container.registerInstance(
      V2TableTrashedProjection,
      new V2TableTrashedProjection(this.v2ContainerService)
    );
    container.registerInstance(
      V2TableRestoredProjection,
      new V2TableRestoredProjection(this.v2ContainerService)
    );
  }
}
