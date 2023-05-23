import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import ShareDBClass from '@teable/sharedb';
import { FieldSupplementService } from '../features/field/field-supplement.service';
import type { ISupplementService } from './interface';
import { SqliteDbAdapter } from './sqlite.adapter';

@Injectable()
export class ShareDbService extends ShareDBClass {
  constructor(
    readonly sqliteDbAdapter: SqliteDbAdapter,
    private readonly fieldSupplementService: FieldSupplementService
  ) {
    super({
      db: sqliteDbAdapter,
    });

    // this.use('submit', this.onSubmit);
    // this.use('apply', this.onApply);
    // this.use('commit', this.onCommit);
    // this.use('afterWrite', this.onAfterWrite);
  }

  getService(type: IdPrefix): ISupplementService {
    // eslint-disable-next-line sonarjs/no-small-switch
    switch (type) {
      case IdPrefix.Field:
        return this.fieldSupplementService;
    }
    throw new Error(`QueryType: ${type} has no service implementation`);
  }

  // private onSubmit(context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) {
  //   console.log('ShareDb:SUBMIT:', context.extra, context.op);

  //   next();
  // }

  // private onApply(context: ShareDBClass.middleware.ApplyContext, next: (err?: unknown) => void) {
  //   console.log('ShareDb:apply:', context.collection, context.op, context.ops, context.snapshot);
  //   const [docType, collectionId] = context.collection.split('_');

  //   docType as IdPrefix;
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
