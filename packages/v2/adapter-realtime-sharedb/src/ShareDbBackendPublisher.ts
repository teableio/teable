import type { DomainError, ILogger } from '@teable/v2-core';
import { domainError, NoopLogger } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type ShareDbClass from 'sharedb';
import type { Doc } from 'sharedb/lib/client';

import type { IShareDbOpPublisher, ShareDbOp } from './ShareDbPublisher';

export class ShareDbBackendPublisher implements IShareDbOpPublisher {
  private readonly logger: ILogger;

  constructor(
    private readonly backend: ShareDbClass,
    logger?: ILogger
  ) {
    this.logger = (logger ?? new NoopLogger())
      .scope('realtime', { engine: 'sharedb' })
      .scope('publisher', { kind: 'backend' });
  }

  async publish(
    _channels: ReadonlyArray<string>,
    op: ShareDbOp
  ): Promise<Result<void, DomainError>> {
    const collection = op.c;
    const docId = op.d;
    if (!collection || !docId) {
      return err(domainError.validation({ message: 'ShareDB op missing collection or docId' }));
    }

    this.logger.debug('ShareDB backend publish', {
      collection,
      docId,
      hasCreate: Boolean(op.create),
      hasDelete: Boolean(op.del),
      hasOp: Boolean(op.op),
    });

    const connection = this.backend.connect();
    const doc = connection.get(collection, docId) as Doc;
    const isDelete = Boolean(op.del);
    const isAlreadyExistsError = (error: unknown): boolean => {
      if (!isDelete) return false;
      const message = error instanceof Error ? error.message : String(error);
      return message.includes('Document already exists');
    };

    return new Promise((resolve) => {
      const done = (error?: unknown) => {
        connection.close();
        if (!error) {
          resolve(ok(undefined));
          return;
        }
        this.logger.warn('ShareDB backend publish failed', {
          collection,
          docId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof Error) {
          resolve(err(domainError.fromUnknown(error)));
          return;
        }
        resolve(err(domainError.unexpected({ message: 'ShareDB submit failed' })));
      };

      if (op.create) {
        doc.fetch((fetchError) => {
          if (fetchError) {
            done(fetchError);
            return;
          }
          if (doc.type) {
            this.logger.debug('ShareDB doc already exists, skip create', {
              collection,
              docId,
            });
            done();
            return;
          }
          doc.create(op.create.data, op.create.type, {}, done);
        });
        return;
      }

      if (op.del) {
        doc.fetch((fetchError) => {
          if (fetchError) {
            done(fetchError);
            return;
          }
          if (!doc.type) {
            doc.create({}, 'json0', {}, (createError) => {
              if (createError && !isAlreadyExistsError(createError)) {
                done(createError);
                return;
              }
              doc.del(done);
            });
            return;
          }
          doc.del(done);
        });
        return;
      }

      if (op.op) {
        doc.fetch((fetchError) => {
          if (fetchError) {
            done(fetchError);
            return;
          }
          doc.submitOp(op.op, {}, done);
        });
        return;
      }

      done();
    });
  }
}
