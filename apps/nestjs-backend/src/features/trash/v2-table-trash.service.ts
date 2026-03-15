import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import { generateOperationId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ResourceType } from '@teable/openapi';
import {
  ProjectionHandler,
  RecordsDeleted,
  TableTrashed,
  TableQueryService,
  ok,
  v2CoreTokens,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import type { IDeleteRecordsPayload } from '../undo-redo/operations/delete-records.operation';
import { V2ContainerService } from '../v2/v2-container.service';
import type { IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import { TableTrashListener } from './listener/table-trash.listener';
import { resolveV2TrashRecordDisplayName } from './v2-trash-record-name';

@ProjectionHandler(RecordsDeleted)
export class V2RecordsDeletedTableTrashProjection implements IEventHandler<RecordsDeleted> {
  constructor(
    private readonly tableTrashListener: TableTrashListener,
    private readonly tableQueryService: TableQueryService
  ) {}

  async handle(
    context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    if (event.recordSnapshots.length === 0) {
      return ok(undefined);
    }

    const tableResult = await this.tableQueryService.getById(context, event.tableId);
    const table = tableResult.isOk() ? tableResult.value : null;

    const records: IDeleteRecordsPayload['records'] = event.recordSnapshots.map((snapshot) => {
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

      if (table) {
        const nameResult = resolveV2TrashRecordDisplayName(table, {
          id: snapshot.id,
          fields: snapshot.fields,
        });
        if (nameResult.isOk() && nameResult.value) {
          record.name = nameResult.value;
        }
      }

      return record;
    });

    await this.tableTrashListener.recordDeleteListener({
      operationId: generateOperationId(),
      windowId: context.windowId,
      tableId: event.tableId.toString(),
      userId: context.actorId.toString(),
      records,
    });

    return ok(undefined);
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

@Injectable()
export class V2TableTrashService implements IV2ProjectionRegistrar, OnModuleInit {
  private readonly logger = new Logger(V2TableTrashService.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly tableTrashListener: TableTrashListener,
    private readonly attachmentsTableService: AttachmentsTableService,
    private readonly prisma: PrismaService
  ) {}

  onModuleInit(): void {
    this.v2ContainerService.addProjectionRegistrar(this);
  }

  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 trash projections');

    const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);

    container.registerInstance(
      V2RecordsDeletedTableTrashProjection,
      new V2RecordsDeletedTableTrashProjection(this.tableTrashListener, tableQueryService)
    );

    container.registerInstance(
      V2RecordsDeletedAttachmentProjection,
      new V2RecordsDeletedAttachmentProjection(this.attachmentsTableService)
    );
    container.registerInstance(V2TableTrashedProjection, new V2TableTrashedProjection(this.prisma));
  }
}
