import type { IOtOperation } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import ShareDBClass from '@teable/sharedb';
import { prismaClient } from '@/backend/config/container.config';
import { fieldService } from '../field/field.service';
import { recordService } from '../record/record.service';
import { tableService } from '../table/table.service';
import { viewService } from '../view/view.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { transactionService } from './transaction.service';

export class ShareDbService extends ShareDBClass {
  constructor(readonly sqliteDbAdapter: SqliteDbAdapter) {
    super({
      db: sqliteDbAdapter,
    });

    // this.use('submit', this.onSubmit);
    // this.use('apply', this.onApply);
    // this.use('commit', this.onCommit);
    // this.use('afterWrite', this.onAfterWrite);
  }

  // private onSubmit(context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) {
  //   console.log('ShareDb:SUBMIT:', context.extra, context.op);

  //   next();
  // }

  // private onApply(context: ShareDBClass.middleware.ApplyContext, next: (err?: unknown) => void) {
  //   console.log('ShareDb:apply:', context.ops, context.snapshot);

  //   next();
  // }

  // private onCommit(context: ShareDBClass.middleware.CommitContext, next: (err?: unknown) => void) {
  //   console.log('ShareDb:COMMIT:', context.ops, context.snapshot);

  //   next();
  // }

  // private onAfterWrite(
  //   context: ShareDBClass.middleware.SubmitContext,
  //   next: (err?: unknown) => void
  // ) {
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

const sqliteDbAdapter = new SqliteDbAdapter(
  tableService,
  recordService,
  fieldService,
  viewService,
  prismaClient,
  transactionService
);

export const shareDbService = new ShareDbService(sqliteDbAdapter);
