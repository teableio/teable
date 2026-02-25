import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import { generateOperationId } from '@teable/core';
import {
  ProjectionHandler,
  RecordsDeleted,
  ok,
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

@ProjectionHandler(RecordsDeleted)
class V2RecordsDeletedTableTrashProjection implements IEventHandler<RecordsDeleted> {
  constructor(private readonly tableTrashListener: TableTrashListener) {}

  async handle(
    context: IExecutionContext,
    event: RecordsDeleted
  ): Promise<Result<void, DomainError>> {
    if (event.recordSnapshots.length === 0) {
      return ok(undefined);
    }

    const records: IDeleteRecordsPayload['records'] = event.recordSnapshots.map((snapshot) => ({
      id: snapshot.id,
      fields: snapshot.fields as IRecord['fields'],
      autoNumber: snapshot.autoNumber,
      createdTime: snapshot.createdTime,
      createdBy: snapshot.createdBy,
      lastModifiedTime: snapshot.lastModifiedTime,
      lastModifiedBy: snapshot.lastModifiedBy,
      order: snapshot.orders,
    }));

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
class V2RecordsDeletedAttachmentProjection implements IEventHandler<RecordsDeleted> {
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

@Injectable()
export class V2TableTrashService implements IV2ProjectionRegistrar, OnModuleInit {
  private readonly logger = new Logger(V2TableTrashService.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly tableTrashListener: TableTrashListener,
    private readonly attachmentsTableService: AttachmentsTableService
  ) {}

  onModuleInit(): void {
    this.v2ContainerService.addProjectionRegistrar(this);
  }

  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 record delete projections');

    container.registerInstance(
      V2RecordsDeletedTableTrashProjection,
      new V2RecordsDeletedTableTrashProjection(this.tableTrashListener)
    );

    container.registerInstance(
      V2RecordsDeletedAttachmentProjection,
      new V2RecordsDeletedAttachmentProjection(this.attachmentsTableService)
    );
  }
}
