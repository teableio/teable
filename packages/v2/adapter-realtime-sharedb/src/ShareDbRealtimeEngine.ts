import type {
  IExecutionContext,
  IRealtimeEngine,
  RealtimeChange,
  RealtimeDocId,
} from '@teable/v2-core';
import { RealtimeDocId as RealtimeDocIdValue } from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2ShareDbTokens } from './di/tokens';
import type { IShareDbOpPublisher, ShareDbOp } from './ShareDbPublisher';

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
  ): Promise<Result<void, string>> {
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
      src: context.actorId.toString(),
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
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _change: RealtimeChange
  ): Promise<Result<void, string>> {
    return err('Not implemented');
  }

  async delete(context: IExecutionContext, docId: RealtimeDocId): Promise<Result<void, string>> {
    const docIdResult = RealtimeDocIdValue.parse(docId);
    if (docIdResult.isErr()) return err(docIdResult.error);

    const { collection, docId: documentId } = docIdResult.value;
    const op: ShareDbOp = {
      create: undefined,
      del: true,
      op: undefined,
      src: context.actorId.toString(),
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
}
