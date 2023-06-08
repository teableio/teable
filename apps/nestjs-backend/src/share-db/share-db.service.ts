import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IOtOperation, ISetRecordOpContext } from '@teable-group/core';
import { OpBuilder, IdPrefix } from '@teable-group/core';
import type { Doc, Error } from '@teable/sharedb';
import ShareDBClass from '@teable/sharedb';
import _ from 'lodash';
import { TransactionService } from 'src/share-db/transaction.service';
import { DerivateChangeService } from './derivate-change.service';
import { EventEnums } from './events';
import type { RecordEvent } from './events';
import { SqliteDbAdapter } from './sqlite.adapter';
import type { ITransactionMeta } from './transaction.service';

type IEventType = 'Create' | 'Edit' | 'Delete';

interface IEventCollectorMeta {
  type: IEventType;
  sort: number;
  context: ShareDBClass.middleware.SubmitContext;
}

@Injectable()
export class ShareDbService extends ShareDBClass {
  private logger = new Logger(ShareDbService.name);

  private eventCollector: Map<string, IEventCollectorMeta[]> = new Map();

  constructor(
    readonly sqliteDbAdapter: SqliteDbAdapter,
    private readonly derivateChangeService: DerivateChangeService,
    private readonly transactionService: TransactionService,
    private readonly eventEmitter: EventEmitter2
  ) {
    super({
      db: sqliteDbAdapter,
    });

    // this.use('submit', this.onSubmit);
    this.use('apply', this.onApply);
    // this.use('commit', this.onCommit);
    // this.use('afterWrite', this.onAfterWrite);
    this.on('submitRequestEnd', this.onSubmitRequestEnd);
  }

  // private onSubmit(context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) {
  //   console.log('ShareDb:SUBMIT:', context.extra, context.op);
  //   next();
  // }

  private onApply = async (
    context: ShareDBClass.middleware.ApplyContext,
    next: (err?: unknown) => void
  ) => {
    const tsMeta = context.extra as ITransactionMeta;
    if (tsMeta.skipCalculate) {
      return next();
    }

    this.derivateChangeService.countTransaction(tsMeta);
    try {
      await this.onRecordApply(context);
    } catch (e) {
      this.derivateChangeService.cleanTransaction(tsMeta);
      return next(e);
    }
    // notice: The timing of updating transactions is crucial, so getOpsToOthers must be called before next().
    const opsToOthers = this.derivateChangeService.getOpsToOthers(tsMeta);

    next();

    // only last onApply triggered within a transaction will return otherSnapshotOps
    // it make sure we not lead to infinite loop
    if (opsToOthers) {
      this.sendOps(opsToOthers.transactionMeta, opsToOthers.otherSnapshotOps);
    }
  };

  async onRecordApply(context: ShareDBClass.middleware.ApplyContext) {
    const [docType, tableId] = context.collection.split('_') as [IdPrefix, string];
    const tsMeta = context.extra as ITransactionMeta;
    const recordId = context.id;
    if (docType !== IdPrefix.Record || !context.op.op || !tsMeta || tsMeta.skipCalculate) {
      return;
    }

    console.log('ShareDb:apply:', context.id, context.op.op, context.extra);
    const opContexts = context.op.op.reduce<ISetRecordOpContext[]>((pre, cur) => {
      const ctx = OpBuilder.editor.setRecord.detect(cur);
      if (ctx) {
        pre.push(ctx);
      }
      return pre;
    }, []);

    if (!opContexts.length) {
      return;
    }

    let fixupOps: IOtOperation[] | undefined = undefined;
    fixupOps = await this.derivateChangeService.getFixupOps(tsMeta, {
      tableId,
      recordId,
      opContexts,
    });

    if (!fixupOps || !fixupOps.length) {
      return;
    }

    console.log('fixUps:', fixupOps);

    fixupOps && context.$fixup(fixupOps);
  }

  private async sendOps(
    transactionMeta: ITransactionMeta,
    otherSnapshotOps: { [tableId: string]: { [recordId: string]: IOtOperation[] } }
  ) {
    console.log('sendOpsAfterApply:', JSON.stringify(otherSnapshotOps, null, 2));
    for (const tableId in otherSnapshotOps) {
      const data = otherSnapshotOps[tableId];
      const collection = `${IdPrefix.Record}_${tableId}`;
      for (const recordId in data) {
        const ops = data[recordId];
        const doc = this.connect().get(collection, recordId);

        await new Promise((resolve, reject) => {
          doc.fetch(() => {
            doc.submitOp(ops, transactionMeta, (error) => {
              if (error) return reject(error);
              resolve(undefined);
            });
          });
        });
      }
    }
  }

  // private onCommit = (context: ShareDBClass.middleware.CommitContext, next: (err?: unknown) => void) => {
  //   console.log('ShareDb:COMMIT:', context.ops, context.snapshot);

  //   next();
  // }

  // private onAfterWrite = (
  //   context: ShareDBClass.middleware.SubmitContext,
  //   next: (err?: unknown) => void
  // ) => {
  //   console.log('ShareDb:afterWrite:', context.ops);

  //   next();
  // }

  private onSubmitRequestEnd(error: Error, context: ShareDBClass.middleware.SubmitContext) {
    const extra = context.extra as { [key: string]: unknown };
    const transactionKey = extra?.transactionKey as string;

    if (error) {
      this.logger.error(error);
      this.removeEventCollector(transactionKey);
      return;
    }

    let cacheEventArray = this.eventCollector.get(transactionKey);
    const transactionCacheMeta = this.transactionService.transactionCache.get(transactionKey);

    const eventType = this.getEventType(context.op)!;
    const cacheEventMeta: IEventCollectorMeta = {
      type: eventType,
      sort: transactionCacheMeta?.currentCount ?? (cacheEventArray?.length ?? 0) + 1,
      context: context,
    };

    (cacheEventArray = cacheEventArray ?? []).push(cacheEventMeta);

    this.eventCollector.set(transactionKey, cacheEventArray);

    if (!transactionCacheMeta) {
      // When the `event group` corresponding to a transaction ID completes,
      // the `type` in the event group is analyzed to dispatch subsequent event tasks
      this.eventAssign(transactionKey, cacheEventArray);
    }
  }

  private removeEventCollector(key: string | undefined) {
    if (!key) {
      return;
    }
    this.eventCollector.delete(key);
  }

  private getEventType(
    op: ShareDBClass.CreateOp | ShareDBClass.DeleteOp | ShareDBClass.EditOp
  ): IEventType | undefined {
    if ('create' in op) {
      return 'Create';
    }
    if ('op' in op) {
      return 'Edit';
    }
    if ('del' in op) {
      return 'Delete';
    }
  }

  private async eventAssign(
    transactionKey: string,
    cacheEventArray: IEventCollectorMeta[]
  ): Promise<void> {
    const getType = (types: IEventType[]): IEventType | undefined => {
      const typeFrequencies = _.countBy(types);
      if (typeFrequencies.Create) {
        return 'Create';
      }
      if (typeFrequencies.Edit && !typeFrequencies.Create && !typeFrequencies.Delete) {
        return 'Edit';
      }
      if (typeFrequencies.Delete && !typeFrequencies.Create && !typeFrequencies.Edit) {
        return 'Delete';
      }
    };

    const allTypes = _.map(cacheEventArray, 'type');
    const type = getType(allTypes)!;
    const lastContext = _.orderBy(cacheEventArray, 'sort', 'desc')[0].context;

    if (type === 'Create') {
      this.createEvent(lastContext);
    }

    if (type === 'Edit') {
      this.editEvent(lastContext);
    }

    if (type === 'Delete') {
      // Delete Event
    }

    this.removeEventCollector(transactionKey);
  }

  private async createEvent(context: ShareDBClass.middleware.SubmitContext): Promise<void> {
    const [docType, collectionId] = context.collection.split('_');
    if (IdPrefix.Record == docType) {
      const eventValue: RecordEvent = {
        eventName: EventEnums.RecordCreated,
        tableId: collectionId,
        recordId: context.id,
        context,
      };
      this.eventEmitter.emitAsync(EventEnums.RecordCreated, eventValue);
    }
  }

  private async editEvent(context: ShareDBClass.middleware.SubmitContext): Promise<void> {
    const [docType, collectionId] = context.collection.split('_');
    if (IdPrefix.Record == docType) {
      const eventValue: RecordEvent = {
        eventName: EventEnums.RecordUpdated,
        tableId: collectionId,
        recordId: context.id,
        context,
      };
      this.eventEmitter.emitAsync(EventEnums.RecordUpdated, eventValue);
    }
  }

  async submitOps(collection: string, id: string, ops: IOtOperation[]) {
    const doc = this.connect().get(collection, id);
    return new Promise<undefined>((resolve, reject) => {
      doc.submitOp(ops, undefined, (error) => {
        if (error) return reject(error);
        console.log('submit succeed!');
        resolve(undefined);
      });
    });
  }

  async createDocument(collection: string, id: string, snapshot: unknown) {
    const doc = this.connect().get(collection, id);
    return new Promise<Doc>((resolve, reject) => {
      doc.create(snapshot, (error) => {
        if (error) return reject(error);
        // console.log(`create document ${collectionId}.${id} succeed!`);
        resolve(doc);
      });
    });
  }
}
