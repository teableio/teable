import { Inject, Injectable } from '@nestjs/common';
import ShareDBClass from 'sharedb';
import { IShareDbConfig } from './interface';

@Injectable()
export class ShareDb extends ShareDBClass {
  constructor(@Inject('SHAREDB_CONFIG') private config: IShareDbConfig) {
    super({
      db: config.db,
    });

    this.use('submit', this.onSubmit);
    this.use('apply', this.onApply);
    this.use('commit', this.onCommit);
    this.use('afterWrite', this.onAfterWrite);
  }

  onSubmit(context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) {
    console.log('ShareDb:SUBMIT:', context.ops, context.snapshot);

    next();
  }

  onApply(context: ShareDBClass.middleware.ApplyContext, next: (err?: unknown) => void) {
    console.log('ShareDb:apply:', context.ops, context.snapshot);

    next();
  }

  onCommit(context: ShareDBClass.middleware.CommitContext, next: (err?: unknown) => void) {
    console.log('ShareDb:COMMIT:', context.ops, context.snapshot);

    next();
  }

  onAfterWrite(context: ShareDBClass.middleware.SubmitContext, next: (err?: unknown) => void) {
    console.log('ShareDb:afterWrite:', context.ops);

    next();
  }
}
