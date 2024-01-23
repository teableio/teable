import { Injectable, Logger } from '@nestjs/common';
import { context as otelContext, trace as otelTrace } from '@opentelemetry/api';
import { IdPrefix, ViewOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDBClass from 'sharedb';
import { EventEmitterService } from '../event-emitter/event-emitter.service';
import type { IClsStore } from '../types/cls';
import { Timing } from '../utils/timing';
import { authMiddleware } from './auth.middleware';
import { derivateMiddleware } from './derivate.middleware';
import { IRawOpMap } from './interface';
import { ShareDbPermissionService } from './share-db-permission.service';
import { ShareDbAdapter } from './share-db.adapter';
import { WsDerivateService } from './ws-derivate.service';

// 1 million op in 400ms
function fastMergeRawOpMaps<T>(objects: { [k1: string]: { [k2: string]: T } }[]): {
  [k1: string]: { [k2: string]: T };
} {
  const result: { [k1: string]: { [k2: string]: T } } = {};

  objects.forEach((obj) => {
    Object.keys(obj).forEach((k1) => {
      if (!result[k1]) {
        result[k1] = { ...obj[k1] };
      } else {
        Object.keys(obj[k1]).forEach((k2) => {
          result[k1][k2] = obj[k1][k2];
        });
      }
    });
  });

  return result;
}

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

    // this.use('submit', this.onSubmit);
    this.use('commit', this.onCommit);

    // broadcast raw op events to client
    this.prismaService.bindAfterTransaction(() => {
      const rawOpMaps = this.cls.get('tx.rawOpMaps');
      const stashOpMap = this.cls.get('tx.stashOpMap');
      this.cls.set('tx.rawOpMaps', undefined);
      this.cls.set('tx.stashOpMap', undefined);
      const rawOpMap = fastMergeRawOpMaps(rawOpMaps || []);
      this.publishOpsMap(rawOpMap);
      (rawOpMap || stashOpMap) && this.eventEmitterService.ops2Event(stashOpMap, rawOpMap);
    });
  }

  getConnection() {
    const connection = this.connect();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    connection.agent!.custom.isBackend = true;
    return connection;
  }

  @Timing()
  publishOpsMap(rawOpMap: IRawOpMap) {
    const { setViewSort, setViewFilter, setViewGroup } = ViewOpBuilder.editor;
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

          const detectFns = [setViewFilter, setViewSort, setViewGroup];
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
      const { setViewFilter, setViewSort, setViewGroup } = ViewOpBuilder.editor;
      const detectFns = [setViewFilter, setViewSort, setViewGroup];
      const action = context.op.op.some((op) => detectFns.some((fn) => fn?.detect(op)));

      if (action) {
        context?.channels?.push(`${IdPrefix.Record}_${tableId}`);
        context?.channels?.push(`${IdPrefix.Field}_${tableId}`);
      }
    }

    next();
  };

  private onSubmit = (
    _context: ShareDBClass.middleware.SubmitContext,
    next: (err?: unknown) => void
  ) => {
    const tracer = otelTrace.getTracer('default');
    const currentSpan = tracer.startSpan('Submit Op');

    // console.log('onSubmit start');

    otelContext.with(otelTrace.setSpan(otelContext.active(), currentSpan), () => {
      next();
    });

    // console.log('onSubmit end');
  };
}
