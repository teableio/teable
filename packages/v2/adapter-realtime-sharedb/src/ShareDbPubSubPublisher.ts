import { domainError, type DomainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { PubSub } from 'sharedb';

import type { IShareDbOpPublisher, ShareDbOp } from './ShareDbPublisher';

type ShareDbPubSub = Pick<PubSub, 'publish'>;
type ShareDbConnectionLike = {
  get: (
    collection: string,
    docId: string
  ) => {
    fetch: (callback: (error?: unknown) => void) => void;
    version?: number | null;
    data?: unknown;
  };
  close: () => void;
};
type ShareDbBackendLike = {
  connect: () => ShareDbConnectionLike;
};

export class ShareDbPubSubPublisher implements IShareDbOpPublisher {
  constructor(
    private readonly pubsub: ShareDbPubSub,
    private readonly backend?: ShareDbBackendLike
  ) {}

  async publish(
    channels: ReadonlyArray<string>,
    op: ShareDbOp
  ): Promise<Result<void, DomainError>> {
    const state = await this.resolveDocState(op);
    const version = state?.version;
    const normalizedOp =
      state?.data !== undefined && op.op ? this.withOldValues(op.op, state.data) : op.op;
    const publishOp = {
      ...op,
      ...(version === undefined ? {} : { v: version }),
      ...(normalizedOp ? { op: normalizedOp } : {}),
    };
    const channelList = [...channels];

    return new Promise((resolve) => {
      this.pubsub.publish(channelList, publishOp, (error) => {
        if (!error) {
          resolve(ok(undefined));
          return;
        }
        if (error instanceof Error) {
          resolve(err(domainError.fromUnknown(error)));
          return;
        }
        resolve(err(domainError.unexpected({ message: 'ShareDB publish failed' })));
      });
    });
  }

  private async resolveDocState(
    op: ShareDbOp
  ): Promise<{ version?: number; data?: unknown } | undefined> {
    if (!this.backend) {
      return undefined;
    }

    const collection = op.c;
    const docId = op.d;
    if (!collection || !docId) {
      return undefined;
    }

    if (!op.op && !op.del) {
      return undefined;
    }

    const connection = this.backend.connect();
    const doc = connection.get(collection, docId);

    try {
      await new Promise<void>((resolve, reject) => {
        doc.fetch((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      return {
        version: typeof doc.version === 'number' ? doc.version : undefined,
        data: doc.data,
      };
    } catch {
      return undefined;
    } finally {
      connection.close();
    }
  }

  private withOldValues(ops: unknown, snapshot: unknown): unknown {
    if (!Array.isArray(ops)) {
      return ops;
    }

    return ops.map((component) => {
      if (!(component instanceof Object)) {
        return component;
      }

      const record = component as Record<string, unknown>;
      const path = this.normalizePath(record.p);
      const hasOi = Object.prototype.hasOwnProperty.call(record, 'oi');
      const hasOd = Object.prototype.hasOwnProperty.call(record, 'od');

      if (!hasOi || hasOd || !path) {
        return component;
      }

      const currentValue = this.readByPath(snapshot, path);
      if (currentValue === undefined) {
        return component;
      }

      return {
        ...record,
        od: currentValue,
      };
    });
  }

  private normalizePath(path: unknown): ReadonlyArray<string | number> | null {
    if (!Array.isArray(path)) {
      return null;
    }

    if (path.every((segment) => typeof segment === 'string' || typeof segment === 'number')) {
      return path as Array<string | number>;
    }

    return null;
  }

  private readByPath(source: unknown, path: ReadonlyArray<string | number>): unknown {
    if (path.length === 0) {
      return source;
    }

    let current: unknown = source;
    for (const segment of path) {
      if (current == null || !(current instanceof Object)) {
        return undefined;
      }

      if (typeof segment === 'number') {
        if (!Array.isArray(current)) {
          return undefined;
        }
        current = current[segment];
      } else {
        current = (current as Record<string, unknown>)[segment];
      }
    }

    return current;
  }
}
