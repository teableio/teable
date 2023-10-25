import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldOpBuilder, IdPrefix, RecordOpBuilder, ViewOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp, Error } from 'sharedb';
import ShareDBClass from 'sharedb';
import { EventEmitterService } from '../event-emitter/event-emitter.service';
import type { IEventBase } from '../event-emitter/interfaces/event-base.interface';
import { RecordUpdatedEvent, FieldUpdatedEvent, ViewUpdatedEvent } from '../event-emitter/model';
import type { IClsStore } from '../types/cls';
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
    private readonly eventService: EventEmitterService,
    private readonly prismaService: PrismaService,
    private readonly clsService: ClsService<IClsStore>,
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

    // broadcast raw op events to client
    this.prismaService.bindAfterTransaction(() => {
      const rawOpMap = this.clsService.get('tx.rawOpMap');
      rawOpMap && this.publishOpsMap(rawOpMap);
    });
  }

  getConnection() {
    const connection = this.connect();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    connection.agent!.custom.isBackend = true;
    return connection;
  }

  publishOpsMap(rawOpMap: IRawOpMap) {
    const { setViewSort } = ViewOpBuilder.editor;
    const rawOps: (EditOp | CreateOp | DeleteOp)[] = [];
    for (const collection in rawOpMap) {
      const data = rawOpMap[collection];
      for (const docId in data) {
        const rawOp = data[docId] as EditOp | CreateOp | DeleteOp;
        const channels = [collection, `${collection}.${docId}`];
        const ops = rawOp.op;
        rawOp.c = collection;
        rawOp.d = docId;
        this.pubsub.publish(channels, rawOp, noop);
        rawOps.push(rawOp);

        /**
         * this is for some special scenarios like manual sort
         * which only send view ops but update record too
         */
        if (ops?.[0] && setViewSort.detect(ops?.[0])) {
          const [prefix, tableId] = collection.split('_');
          this.pubsub.publish([`${IdPrefix.Record}_${tableId}`], rawOp, noop);
        }
      }
    }
    this.eventService.ops2Event(rawOps);
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
