import { Injectable, Logger } from '@nestjs/common';
import { loadPackage } from '@nestjs/common/utils/load-package.util';
import { context as otelContext, trace as otelTrace } from '@opentelemetry/api';
import { FieldOpBuilder, IdPrefix, ViewOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDBClass from 'sharedb';
import { CacheConfig, ICacheConfig } from '../configs/cache.config';
import { EventEmitterService } from '../event-emitter/event-emitter.service';
import type { IClsStore } from '../types/cls';
import { Timing } from '../utils/timing';
import { authMiddleware } from './auth.middleware';
import type { IRawOpMap } from './interface';
import { ShareDbAdapter } from './share-db.adapter';

@Injectable()
export class ShareDbService extends ShareDBClass {
  private logger = new Logger(ShareDbService.name);

  constructor(
    readonly shareDbAdapter: ShareDbAdapter,
    private readonly eventEmitterService: EventEmitterService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @CacheConfig() private readonly cacheConfig: ICacheConfig
  ) {
    super({
      presence: true,
      doNotForwardSendPresenceErrorsToClient: true,
      db: shareDbAdapter,
    });

    const { provider, redis } = this.cacheConfig;

    if (provider === 'redis') {
      const redisPubsub = loadPackage('sharedb-redis-pubsub', ShareDbService.name, () =>
        require('sharedb-redis-pubsub')
      )({ url: redis.uri });

      this.logger.log(`> Detected Redis cache; enabled the Redis pub/sub adapter for ShareDB.`);
      this.pubsub = redisPubsub;
    }

    authMiddleware(this);
    this.use('submit', this.onSubmit);

    // broadcast raw op events to client
    this.prismaService.bindAfterTransaction(() => {
      const rawOpMaps = this.cls.get('tx.rawOpMaps');
      this.cls.set('tx.rawOpMaps', undefined);

      const ops: IRawOpMap[] = [];
      if (rawOpMaps?.length) {
        ops.push(...rawOpMaps);
      }

      if (ops.length) {
        this.publishOpsMap(rawOpMaps);
        this.eventEmitterService.ops2Event(ops);
      }
    });
  }

  getConnection() {
    return this.connect();
  }

  @Timing()
  publishOpsMap(rawOpMaps: IRawOpMap[] | undefined) {
    if (!rawOpMaps?.length) {
      return;
    }

    for (const rawOpMap of rawOpMaps) {
      for (const collection in rawOpMap) {
        const data = rawOpMap[collection];
        for (const docId in data) {
          const rawOp = data[docId] as EditOp | CreateOp | DeleteOp;
          const channels = [collection, `${collection}.${docId}`];
          rawOp.c = collection;
          rawOp.d = docId;
          this.pubsub.publish(channels, rawOp, noop);

          if (this.shouldPublishAction(rawOp)) {
            const tableId = collection.split('_')[1];
            this.publishRelatedChannels(tableId, rawOp);
          }
        }
      }
    }
  }

  private shouldPublishAction(rawOp: EditOp | CreateOp | DeleteOp) {
    const viewKeys = ['filter', 'sort', 'group', 'lastModifiedTime'];
    const fieldKeys = ['options'];
    return rawOp.op?.some(
      (op) =>
        viewKeys.includes(ViewOpBuilder.editor.setViewProperty.detect(op)?.key as string) ||
        fieldKeys.includes(FieldOpBuilder.editor.setFieldProperty.detect(op)?.key as string)
    );
  }

  /**
   * this is for some special scenarios like manual sort
   * which only send view ops but update record too
   */
  private publishRelatedChannels(tableId: string, rawOp: EditOp | CreateOp | DeleteOp) {
    this.pubsub.publish([`${IdPrefix.Record}_${tableId}`], rawOp, noop);
    this.pubsub.publish([`${IdPrefix.Field}_${tableId}`], rawOp, noop);
  }

  private onSubmit = (
    context: ShareDBClass.middleware.SubmitContext,
    next: (err?: unknown) => void
  ) => {
    const tracer = otelTrace.getTracer('default');
    const currentSpan = tracer.startSpan('submitOp');

    // console.log('onSubmit start');

    otelContext.with(otelTrace.setSpan(otelContext.active(), currentSpan), () => {
      const [docType] = context.collection.split('_');

      if (docType !== IdPrefix.Record || !context.op.op) {
        return next(new Error('only record op can be committed'));
      }
      next();
    });

    // console.log('onSubmit end');
  };
}
