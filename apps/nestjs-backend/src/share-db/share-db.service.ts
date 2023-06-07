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
