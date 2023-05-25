import { Injectable } from '@nestjs/common';
import type { IOtOperation, ISetRecordOpContext } from '@teable-group/core';
import { OpBuilder, IdPrefix } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import ShareDBClass from '@teable/sharedb';
import { DerivateChangeService } from './derivate-change.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import type { ITransactionMeta } from './transaction.service';

@Injectable()
export class ShareDbService extends ShareDBClass {
  constructor(
    readonly sqliteDbAdapter: SqliteDbAdapter,
    private readonly derivateChangeService: DerivateChangeService
  ) {
    super({
      db: sqliteDbAdapter,
    });

    // this.use('submit', this.onSubmit);
    this.use('apply', this.onApply);
    // this.use('commit', this.onCommit);
    // this.use('afterWrite', this.onAfterWrite);
  }

  // private onSubmit(context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) {
  //   console.log('ShareDb:SUBMIT:', context.extra, context.op);
  //   next();
  // }

  private onApply = async (
    context: ShareDBClass.middleware.ApplyContext,
    next: (err?: unknown) => void
  ) => {
    const [docType, tableId] = context.collection.split('_') as [IdPrefix, string];
    const recordId = context.id;
    if (docType !== IdPrefix.Record || !context.op.op || context.options?.skipCalculate) {
      return next();
    }

    console.log('ShareDb:apply:', context.id, context.op.op, context.options);

    const opContexts = context.op.op.reduce<ISetRecordOpContext[]>((pre, cur) => {
      const ctx = OpBuilder.editor.setRecord.detect(cur);
      if (ctx) {
        pre.push(ctx);
      }
      return pre;
    }, []);

    if (!opContexts.length) {
      return next();
    }

    let fixUps:
      | {
          currentSnapshotOps: IOtOperation[];
          otherSnapshotOps: { [tableId: string]: { [recordId: string]: IOtOperation[] } };
          transactionMeta: ITransactionMeta;
        }
      | undefined = undefined;
    try {
      fixUps = await this.derivateChangeService.getFixupOps(
        context.options,
        tableId,
        recordId,
        opContexts
      );

      if (!fixUps) {
        return next();
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fixUps.currentSnapshotOps.length && (context as any).$fixup(fixUps.currentSnapshotOps);
    } catch (e) {
      return next(e);
    }

    next();
    const { otherSnapshotOps, transactionMeta } = fixUps;
    this.sendOps(transactionMeta, otherSnapshotOps);
  };

  private async sendOps(
    transactionMeta: ITransactionMeta,
    otherSnapshotOps: { [tableId: string]: { [recordId: string]: IOtOperation[] } }
  ) {
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
