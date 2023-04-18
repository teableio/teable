import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IOtOperation } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { Doc, Error } from '@teable/sharedb';
import ShareDBClass from '@teable/sharedb';
import { RecordCreatedEvent } from './events';
import { SqliteDbAdapter } from './sqlite.adapter';

@Injectable()
export class ShareDbService extends ShareDBClass {
  private logger = new Logger(ShareDbService.name);

  constructor(readonly sqliteDbAdapter: SqliteDbAdapter, private eventEmitter: EventEmitter2) {
    super({
      db: sqliteDbAdapter,
    });

    // this.use('submit', this.onSubmit);
    // this.use('apply', this.onApply);
    // this.use('commit', this.onCommit);
    // this.use('afterWrite', this.onAfterWrite);
    this.on('submitRequestEnd', this.onSubmitRequestEnd);
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

  private onSubmitRequestEnd(error: Error, context: ShareDBClass.middleware.SubmitContext) {
    if (error) {
      this.logger.error(error);
      return;
    }

    if (context.op.create) {
      const [docType, collectionId] = context.collection.split('_');

      // Dispatch record created success event
      if (IdPrefix.Record == docType) {
        this.eventEmitter.emitAsync(RecordCreatedEvent.EVENT_NAME, {
          tableId: collectionId,
          recordId: context.id,
          context,
        });
      }
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
