import type {
  DomainError,
  IExecutionContext,
  IRealtimeEngine,
  RealtimeApplyChangeOptions,
  RealtimeChange,
  RealtimeDocId,
} from '@teable/v2-core';
import { domainError } from '@teable/v2-core';
import { RealtimeDocId as RealtimeDocIdValue } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2ShareDbTokens } from './di/tokens';
import type { IShareDbOpPublisher, ShareDbOp } from './ShareDbPublisher';

const v2ProjectionOpSourcePrefix = '@@v2-projection:';

@injectable()
export class ShareDbRealtimeEngine implements IRealtimeEngine {
  constructor(
    @inject(v2ShareDbTokens.publisher)
    private readonly publisher: IShareDbOpPublisher
  ) {}

  async ensure(
    context: IExecutionContext,
    docId: RealtimeDocId,
    initial: unknown
  ): Promise<Result<void, DomainError>> {
    const docIdResult = RealtimeDocIdValue.parse(docId);
    if (docIdResult.isErr()) return err(docIdResult.error);

    const { collection, docId: documentId } = docIdResult.value;
    const op: ShareDbOp = {
      create: {
        type: 'json0',
        data: initial,
      },
      del: undefined,
      op: undefined,
      src: this.toProjectionSource(context.requestId),
      seq: 1,
      v: 0,
      m: {
        ts: Date.now(),
      },
      c: collection,
      d: documentId,
    };

    const channels = [collection, `${collection}.${documentId}`];
    return this.publisher.publish(channels, op);
  }

  async applyChange(
    context: IExecutionContext,
    docId: RealtimeDocId,
    change: RealtimeChange | ReadonlyArray<RealtimeChange>,
    options?: RealtimeApplyChangeOptions
  ): Promise<Result<void, DomainError>> {
    const docIdResult = RealtimeDocIdValue.parse(docId);
    if (docIdResult.isErr()) return err(docIdResult.error);

    const { collection, docId: documentId } = docIdResult.value;

    // Convert RealtimeChange to json0 operation
    const changes = Array.isArray(change) ? change : [change];
    if (changes.length === 0)
      return err(domainError.validation({ message: 'No changes to apply' }));

    const json0Op = changes.flatMap((item) => this.toJson0Op(item));

    const op: ShareDbOp = {
      create: undefined,
      del: undefined,
      op: json0Op,
      src: this.toProjectionSource(context.requestId),
      seq: 1,
      v: options?.version ?? 0,
      m: {
        ts: Date.now(),
      },
      c: collection,
      d: documentId,
    };

    const channels = [collection, `${collection}.${documentId}`];
    return this.publisher.publish(channels, op);
  }

  private toJson0Op(change: RealtimeChange): unknown[] {
    const path = [...change.path];

    switch (change.type) {
      case 'set': {
        // json0 object replace: { p: path, od: oldValue, oi: newValue }
        if (Object.prototype.hasOwnProperty.call(change, 'oldValue')) {
          return [{ p: path, oi: change.value, od: change.oldValue }];
        }
        return [{ p: path, oi: change.value }];
      }
      case 'insert': {
        // json0 list insert: { p: path.concat(index), li: value }
        return [{ p: [...path, change.index], li: change.value }];
      }
      case 'delete': {
        // json0 list delete: { p: path.concat(index), ld: value }
        // For multiple deletes, we need multiple ops (delete from end to start to keep indices valid)
        const ops: unknown[] = [];
        for (let i = change.count - 1; i >= 0; i--) {
          ops.push({ p: [...path, change.index + i], ld: true });
        }
        return ops;
      }
    }
  }

  async delete(
    context: IExecutionContext,
    docId: RealtimeDocId
  ): Promise<Result<void, DomainError>> {
    const docIdResult = RealtimeDocIdValue.parse(docId);
    if (docIdResult.isErr()) return err(docIdResult.error);

    const { collection, docId: documentId } = docIdResult.value;
    const op: ShareDbOp = {
      create: undefined,
      del: true,
      op: undefined,
      src: this.toProjectionSource(context.requestId),
      seq: 1,
      v: 1,
      m: {
        ts: Date.now(),
      },
      c: collection,
      d: documentId,
    };

    const channels = [collection, `${collection}.${documentId}`];
    return this.publisher.publish(channels, op);
  }

  private toProjectionSource(requestId: string | undefined): string {
    return `${v2ProjectionOpSourcePrefix}${requestId ?? 'unknown'}`;
  }
}
