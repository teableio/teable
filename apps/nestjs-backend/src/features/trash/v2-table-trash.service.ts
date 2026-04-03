import { Injectable, Logger } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import { generateOperationId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';
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
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import type { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import { V2RecordTrashService } from './v2-record-trash.service';

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
  constructor(private readonly attachmentsTableService: AttachmentsTableService) {}

  async handle(
    _context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    if (event.recordIds.length === 0) {
      return ok(undefined);
    }

    await this.attachmentsTableService.deleteRecords(
      event.tableId.toString(),
      event.recordIds.map((id) => id.toString())
    );

    return ok(undefined);
  }
}

@ProjectionHandler(TableTrashed)
export class V2TableTrashedProjection implements IEventHandler<TableTrashed> {
  constructor(private readonly prisma: PrismaService) {}

  async handle(
    context: IExecutionContext,
    event: TableTrashed
  ): Promise<Result<void, DomainError>> {
    const table = await this.prisma.tableMeta.findUnique({
      where: { id: event.tableId.toString() },
      select: { baseId: true, deletedTime: true },
    });

    if (!table?.deletedTime) {
      return ok(undefined);
    }

    await this.prisma.trash.deleteMany({
      where: {
        resourceId: event.tableId.toString(),
        resourceType: ResourceType.Table,
      },
    });

    await this.prisma.trash.create({
      data: {
        resourceId: event.tableId.toString(),
        resourceType: ResourceType.Table,
        parentId: table.baseId,
        deletedTime: table.deletedTime,
        deletedBy: context.actorId.toString(),
      },
    });

    return ok(undefined);
  }
}

@ProjectionHandler(TableRestored)
export class V2TableRestoredProjection implements IEventHandler<TableRestored> {
  constructor(private readonly prisma: PrismaService) {}

  async handle(
    _context: IExecutionContext,
    event: TableRestored
  ): Promise<Result<void, DomainError>> {
    await this.prisma.trash.deleteMany({
      where: {
        resourceId: event.tableId.toString(),
        resourceType: ResourceType.Table,
      },
    });

    return ok(undefined);
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2TableTrashService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2TableTrashService.name);

  constructor(
    private readonly v2RecordTrashService: V2RecordTrashService,
    private readonly attachmentsTableService: AttachmentsTableService,
    private readonly prisma: PrismaService
  ) {}

  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 trash projections');

    container.registerInstance(
      V2RecordsDeletedTableTrashProjection,
      new V2RecordsDeletedTableTrashProjection(this.v2RecordTrashService)
    );

    container.registerInstance(
      V2RecordsDeletedAttachmentProjection,
      new V2RecordsDeletedAttachmentProjection(this.attachmentsTableService)
    );
    container.registerInstance(V2TableTrashedProjection, new V2TableTrashedProjection(this.prisma));
    container.registerInstance(
      V2TableRestoredProjection,
      new V2TableRestoredProjection(this.prisma)
    );
  }
}
