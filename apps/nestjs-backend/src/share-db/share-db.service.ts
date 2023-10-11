import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldOpBuilder, IdPrefix, RecordOpBuilder, ViewOpBuilder } from '@teable-group/core';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp, Error } from 'sharedb';
import ShareDBClass from 'sharedb';
import type { IEventBase } from '../event-emitter/interfaces/event-base.interface';
import { RecordUpdatedEvent, FieldUpdatedEvent, ViewUpdatedEvent } from '../event-emitter/model';
import { authMiddleware } from './auth.middleware';
import { derivateMiddleware } from './derivate.middleware';
import type { IRawOpMap } from './interface';
import { SqliteDbAdapter } from './sqlite.adapter';
import { WsAuthService } from './ws-auth.service';
import { WsDerivateService } from './ws-derivate.service';

@Injectable()
export class ShareDbService extends ShareDBClass {
  private logger = new Logger(ShareDbService.name);

  constructor(
    readonly sqliteDbAdapter: SqliteDbAdapter,
    private readonly eventEmitter: EventEmitter2,
    private readonly clsService: ClsService,
    private readonly wsAuthService: WsAuthService,
    private readonly wsDerivateService: WsDerivateService
  ) {
    super({
      presence: true,
      doNotForwardSendPresenceErrorsToClient: true,
      db: sqliteDbAdapter,
    });
    // auth
    authMiddleware(this, this.wsAuthService, this.clsService);
    derivateMiddleware(this, this.wsDerivateService);

    this.use('commit', this.onCommit);
    this.on('submitRequestEnd', this.onSubmitRequestEnd);
  }

  getConnection() {
    const connection = this.connect();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    connection.agent!.custom.isBackend = true;
    return connection;
  }

  publishOpsMap(rawOpMap: IRawOpMap) {
    for (const collection in rawOpMap) {
      const data = rawOpMap[collection];
      for (const docId in data) {
        const rawOp = data[docId] as EditOp | CreateOp | DeleteOp;
        const channels = [collection, `${collection}.${docId}`];
        rawOp.c = collection;
        rawOp.d = docId;
        this.pubsub.publish(channels, rawOp, noop);
      }
    }
  }

  private onCommit = (
    context: ShareDBClass.middleware.CommitContext,
    next: (err?: unknown) => void
  ) => {
    const [docType, tableId] = context.collection.split('_');

    // Additional publish/subscribe `record channels` are required for changes to view properties
    if (docType === IdPrefix.View && context.op.op) {
      const { setViewFilter, setViewSort } = ViewOpBuilder.editor;
      const detectFns = [setViewFilter, setViewSort];
      const action = context.op.op.some((op) => detectFns.some((fn) => fn?.detect(op)));

      if (action) {
        context?.channels?.push(`${IdPrefix.Record}_${tableId}`);
      }
    }

    next();
  };

  private onSubmitRequestEnd(error: Error, context: ShareDBClass.middleware.SubmitContext) {
    const isBackend = Boolean(context.agent.custom?.isBackend);
    if (error) {
      this.logger.error(error);
      return;
    }
    if (isBackend) {
      return;
    }
    // When the `event group` corresponding to a transaction ID completes,
    // the `type` in the event group is analyzed to dispatch subsequent event tasks
    this.editEvent(context);
  }

  private editEvent(context: ShareDBClass.middleware.SubmitContext): void {
    const [docType, collectionId] = context.collection.split('_');
    if (!context.op.op) {
      return;
    }

    let eventValue: IEventBase | undefined;
    if (IdPrefix.Record == docType) {
      eventValue = new RecordUpdatedEvent(
        collectionId,
        context.id,
        // context.snapshot?.data,
        RecordOpBuilder.ops2Contexts(context.op.op)
      );
    } else if (IdPrefix.Field == docType) {
      eventValue = new FieldUpdatedEvent(
        collectionId,
        context.id,
        // context.snapshot?.data,
        FieldOpBuilder.ops2Contexts(context.op.op)
      );
    } else if (IdPrefix.View == docType) {
      eventValue = new ViewUpdatedEvent(
        collectionId,
        context.id,
        // context.snapshot?.data,
        ViewOpBuilder.ops2Contexts(context.op.op)
      );
    }

    if (eventValue) {
      this.eventEmitter.emit(eventValue.eventName, eventValue.toJSON());
    }
  }
}
