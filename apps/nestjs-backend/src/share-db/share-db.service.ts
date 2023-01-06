import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import ShareDBClass from 'sharedb';
import { SqliteDbAdapter } from './sqlite.adapter';

@Injectable()
export class ShareDbService extends ShareDBClass {
  constructor(readonly sqliteDbAdapter: SqliteDbAdapter) {
    super({
      db: sqliteDbAdapter,
    });

    this.use('submit', this.onSubmit);
    this.use('apply', this.onApply);
    this.use('commit', this.onCommit);
    this.use('afterWrite', this.onAfterWrite);
  }

  private onSubmit(context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) {
    console.log('ShareDb:SUBMIT:', context.ops, context.snapshot);

    next();
  }

  private onApply(context: ShareDBClass.middleware.ApplyContext, next: (err?: unknown) => void) {
    console.log('ShareDb:apply:', context.ops, context.snapshot);

    next();
  }

  private onCommit(context: ShareDBClass.middleware.CommitContext, next: (err?: unknown) => void) {
    console.log('ShareDb:COMMIT:', context.ops, context.snapshot);

    next();
  }

  private onAfterWrite(
    context: ShareDBClass.middleware.SubmitContext,
    next: (err?: unknown) => void
  ) {
    console.log('ShareDb:afterWrite:', context.ops);

    next();
  }

  async submitOps(collectionName: 'table' | 'dashboard', id: string, ops: IOtOperation[]) {
    const doc = this.connect().get(collectionName, id);
    return new Promise<undefined>((resolve, reject) => {
      doc.submitOp(ops, undefined, (error) => {
        if (error) return reject(error);
        console.log('submit succeed!');
        resolve(undefined);
      });
    });
  }

  async createDocument(collectionName: 'table' | 'dashboard', id: string) {
    const doc = this.connect().get(collectionName, id);
    return new Promise<undefined>((resolve, reject) => {
      doc.create({ title: id }, (error) => {
        if (error) return reject(error);
        console.log('create succeed!');
        resolve(undefined);
      });
    });
  }
}
