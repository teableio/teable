import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix, ViewOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDBClass from 'sharedb';
import { EventEmitterService } from '../event-emitter/event-emitter.service';
import type { IClsStore } from '../types/cls';
import { authMiddleware } from './auth.middleware';
import { derivateMiddleware } from './derivate.middleware';
import type { IRawOpMap } from './interface';
import { ShareDbPermissionService } from './share-db-permission.service';
import { ShareDbAdapter } from './share-db.adapter';
import { WsDerivateService } from './ws-derivate.service';

@Injectable()
export class ShareDbService extends ShareDBClass {
  private logger = new Logger(ShareDbService.name);

  constructor(
    readonly shareDbAdapter: ShareDbAdapter,
    private readonly eventEmitterService: EventEmitterService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly wsDerivateService: WsDerivateService,
    private readonly shareDbPermissionService: ShareDbPermissionService
  ) {
    super({
      presence: true,
      doNotForwardSendPresenceErrorsToClient: true,
      db: shareDbAdapter,
    });
    // auth
    authMiddleware(this, this.shareDbPermissionService);
    derivateMiddleware(this, this.cls, this.wsDerivateService);

    this.use('commit', this.onCommit);

    // broadcast raw op events to client
    this.prismaService.bindAfterTransaction(() => {
      const rawOpMap = this.cls.get('tx.rawOpMap');
      const stashOpMap = this.cls.get('tx.stashOpMap');

      rawOpMap && this.publishOpsMap(rawOpMap);
      (rawOpMap || stashOpMap) && this.eventEmitterService.ops2Event(stashOpMap, rawOpMap);
    });
  }

  getConnection() {
    const connection = this.connect();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    connection.agent!.custom.isBackend = true;
    return connection;
  }

  publishOpsMap(rawOpMap: IRawOpMap) {
    const { setViewSort, setViewFilter } = ViewOpBuilder.editor;
    for (const collection in rawOpMap) {
      const data = rawOpMap[collection];
      for (const docId in data) {
        const rawOp = data[docId] as EditOp | CreateOp | DeleteOp;
        const channels = [collection, `${collection}.${docId}`];
        const ops = rawOp.op;
        rawOp.c = collection;
        rawOp.d = docId;
        this.pubsub.publish(channels, rawOp, noop);

        /**
         * this is for some special scenarios like manual sort
         * which only send view ops but update record too
         */
        if (ops?.[0]) {
          const [, tableId] = collection.split('_');

          const detectFns = [setViewFilter, setViewSort];
          const action = ops.some((op) => detectFns.some((fn) => fn?.detect(op)));

          if (action) {
            this.pubsub.publish([`${IdPrefix.Record}_${tableId}`], rawOp, noop);
            this.pubsub.publish([`${IdPrefix.Field}_${tableId}`], rawOp, noop);
          }
        }
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
        context?.channels?.push(`${IdPrefix.Field}_${tableId}`);
      }
    }

    next();
  };
}
