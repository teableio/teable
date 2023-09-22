import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldOpBuilder, IdPrefix, RecordOpBuilder, ViewOpBuilder } from '@teable-group/core';
import type { Error } from 'sharedb';
import ShareDBClass from 'sharedb';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IEventBase } from '../event-emitter/interfaces/event-base.interface';
import { RecordUpdatedEvent, FieldUpdatedEvent, ViewUpdatedEvent } from '../event-emitter/model';
import type { ICellChange } from '../features/calculation/utils/changes';
import { DerivateChangeService } from './derivate-change.service';
import type { IRawOpMap } from './interface';
import { SqliteDbAdapter } from './sqlite.adapter';

@Injectable()
export class ShareDbService extends ShareDBClass {
  private logger = new Logger(ShareDbService.name);

  constructor(
    readonly sqliteDbAdapter: SqliteDbAdapter,
    private readonly derivateChangeService: DerivateChangeService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cls: ClsService
  ) {
    super({
      presence: true,
      doNotForwardSendPresenceErrorsToClient: true,
      db: sqliteDbAdapter,
    });

    // this.use('submit', this.onSubmit);
    this.use('commit', this.onCommit);
    // this.use('apply', this.onApply);
    this.use('afterWrite', this.onAfterWrite);
    this.on('submitRequestEnd', this.onSubmitRequestEnd);
  }

  getConnection() {
    const connection = this.connect();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    connection.agent!.custom.isBackend = true;
    return connection;
  }

  // private onSubmit = async (
  //   context: ShareDBClass.middleware.SubmitContext,
  //   next: (err?: unknown) => void
  // ) => {
  //   next();
  // };

  /**
   * Goal:
   * 1. we need all effect to be done when get API response
   * 2. all effect should be done in one transaction
   */
  // private onApply = async (
  //   context: ShareDBClass.middleware.ApplyContext,
  //   next: (err?: unknown) => void
  // ) => {
  //   next();
  //   await this.onRecordApply(context);
  // };

  private async onRecordApply(context: ShareDBClass.middleware.SubmitContext) {
    const [docType, tableId] = context.collection.split('_') as [IdPrefix, string];
    const recordId = context.id;
    if (docType !== IdPrefix.Record || !context.op.op) {
      return;
    }

    console.log('onRecordApply', context.op.op);
    const changes = context.op.op.reduce<ICellChange[]>((pre, cur) => {
      const ctx = RecordOpBuilder.editor.setRecord.detect(cur);
      if (ctx) {
        pre.push({
          tableId: tableId,
          recordId: recordId,
          ...ctx,
        });
      }
      return pre;
    }, []);

    if (!changes.length) {
      return;
    }

    try {
      const rawOpsMap = await this.derivateChangeService.derivateAndCalculateLink(
        context.op.src,
        changes
      );
      rawOpsMap && this.publishOpsMap(rawOpsMap);
    } catch (e) {
      console.error('calculationError', e);
      await this.rollback(context);
    }
  }

  private async rollback(context: ShareDBClass.middleware.SubmitContext) {
    //
  }

  publishOpsMap(rawOpMap: IRawOpMap) {
    for (const tableId in rawOpMap) {
      const collection = `${IdPrefix.Record}_${tableId}`;
      const data = rawOpMap[tableId];
      for (const recordId in data) {
        const rawOp = data[recordId];
        const channels = [collection, `${collection}.${recordId}`];
        rawOp.c = collection;
        rawOp.d = recordId;
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

  private onAfterWrite = async (
    context: ShareDBClass.middleware.SubmitContext,
    next: (err?: unknown) => void
  ) => {
    await this.onRecordApply(context);
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
