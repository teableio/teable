import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IOtOperation } from '@teable-group/core';
import { IdPrefix, RecordOpBuilder, OpName } from '@teable-group/core';
import type { Doc, Error } from '@teable/sharedb';
import ShareDBClass from '@teable/sharedb';
import { map, orderBy, uniq } from 'lodash';
import { DerivateChangeService } from './derivate-change.service';
import type { RecordEvent } from './events';
import { EventEnums } from './events';
import { SqliteDbAdapter } from './sqlite.adapter';
import type { ITransactionMeta } from './transaction.service';
import { TransactionService } from './transaction.service';

enum IEventType {
  Create = 'create',
  Edit = 'edit',
  Delete = 'delete',
}

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
    this.use('commit', this.onCommit);
    this.use('apply', this.onApply);
    // this.use('afterWrite', this.onAfterWrite);
    this.on('submitRequestEnd', this.onSubmitRequestEnd);
  }

  getConnection(transactionKey: string) {
    const connection = this.connect();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    connection.agent!.custom = {
      transactionKey,
      isBackend: true,
    };
    return connection;
  }

  // private onSubmit = (
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
  private onApply = async (
    context: ShareDBClass.middleware.ApplyContext,
    next: (err?: unknown) => void
  ) => {
    const tsMeta = context.extra as ITransactionMeta;
    if (tsMeta.skipCalculate || context.agent.custom?.transactionKey) {
      return next();
    }

    this.derivateChangeService.countTransaction(tsMeta);
    let derivateData: Awaited<ReturnType<DerivateChangeService['derivateAndCalculateLink']>>;
    try {
      await this.onRecordApply(context);
      // notice: The timing of updating transactions is crucial, so getOpsToOthers must be called before next().
      derivateData = await this.derivateChangeService.derivateAndCalculateLink(tsMeta);
    } catch (e) {
      this.derivateChangeService.cleanTransaction(tsMeta);
      return next(e);
    }

    next();

    // only last onApply triggered within a transaction will return otherSnapshotOps
    // it make sure we not lead to infinite loop
    if (derivateData) {
      const send = (error: Error, context: ShareDBClass.middleware.SubmitContext) => {
        if (tsMeta.transactionKey === (context.extra as ITransactionMeta).transactionKey) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          this.sendOpsMap(derivateData!.transactionMeta, derivateData!.opsMap);
          this.off('submitRequestEnd', send);
          clearTimeout(timer);
        }
      };
      // 10s limit Exceed, incase of memory leak
      const timer = setTimeout(() => {
        console.error('sendOpsMap timeout exceed');
        this.off('submitRequestEnd', send);
      }, 10000);
      this.on('submitRequestEnd', send);
    }
  };

  async onRecordApply(context: ShareDBClass.middleware.ApplyContext) {
    const [docType, tableId] = context.collection.split('_') as [IdPrefix, string];
    const tsMeta = context.extra as ITransactionMeta;
    const recordId = context.id;
    if (docType !== IdPrefix.Record || !context.op.op || !tsMeta || tsMeta.skipCalculate) {
      return;
    }
    // prepare transaction
    await this.transactionService.getTransaction(tsMeta);
    console.log('ShareDb:apply:', context.id, JSON.stringify(context.op.op), context.extra);
    const ops = context.op.op.reduce<IOtOperation[]>((pre, cur) => {
      const ctx = RecordOpBuilder.editor.setRecord.detect(cur);
      if (ctx) {
        pre.push(cur);
      }
      return pre;
    }, []);

    if (!ops.length) {
      return;
    }

    this.derivateChangeService.cacheChanges(tsMeta, tableId, recordId, ops);
  }

  private async sendOpsMap(
    transactionMeta: ITransactionMeta,
    opsMap: { [tableId: string]: { [recordId: string]: IOtOperation[] } }
  ) {
    console.log('sendOpsAfterApply:', JSON.stringify(opsMap, null, 2));
    const connection = this.connect();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    connection.agent!.custom = transactionMeta;
    for (const tableId in opsMap) {
      const data = opsMap[tableId];
      const collection = `${IdPrefix.Record}_${tableId}`;
      for (const recordId in data) {
        const ops = data[recordId];
        const doc = connection.get(collection, recordId);
        await new Promise((resolve, reject) => {
          doc.fetch((error) => {
            if (error) {
              return reject(error);
            }
            doc.submitOp(ops, transactionMeta, (error) => {
              if (error) {
                return reject(error);
              }
              resolve(undefined);
            });
          });
        });
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
      const listenOp = [OpName.SetViewFilter];
      // const ops2Contexts = OpBuilder.ops2Contexts(context.op.op);
      const ctx = RecordOpBuilder.editor.setRecord.detect(context.op.op);

      // if (ops2Contexts.some((value) => listenOp.includes(value.name))) {
      //   context?.channels?.push(`${IdPrefix.Record}_${tableId}`);
      // }
    }

    next();
  };

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
    const transactionCacheMeta = this.transactionService.getCache(transactionKey);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
      return IEventType.Create;
    }
    if ('op' in op) {
      return IEventType.Edit;
    }
    if ('del' in op) {
      return IEventType.Delete;
    }
  }

  private async eventAssign(
    transactionKey: string,
    cacheEventArray: IEventCollectorMeta[]
  ): Promise<void> {
    const getType = (types: IEventType[]): IEventType | undefined => {
      const uniqueType = uniq(types);
      if (uniqueType.length === 1) {
        if (uniqueType.includes(IEventType.Edit)) {
          return IEventType.Edit;
        }
        if (uniqueType.includes(IEventType.Delete)) {
          return IEventType.Delete;
        }
      } else {
        if (uniqueType.includes(IEventType.Create)) {
          return IEventType.Create;
        }
      }
    };

    const allTypes = map(cacheEventArray, 'type');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const type = getType(allTypes)!;
    const lastContext = orderBy(cacheEventArray, 'sort', 'desc')[0].context;

    if (type === IEventType.Create) {
      this.createEvent(lastContext);
    }

    if (type === IEventType.Edit) {
      this.editEvent(lastContext);
    }

    if (type === IEventType.Delete) {
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
