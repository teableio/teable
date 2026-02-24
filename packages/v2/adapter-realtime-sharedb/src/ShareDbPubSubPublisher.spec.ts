import { describe, expect, it } from 'vitest';
import type { PubSub } from 'sharedb';

import { ShareDbPubSubPublisher } from './ShareDbPubSubPublisher';

describe('ShareDbPubSubPublisher', () => {
  it('uses backend document version for edit ops', async () => {
    let publishedOp: unknown;
    const pubsub = {
      publish: (
        _channels: string[],
        op: { [k: string]: unknown },
        cb: (error: Error | null) => void
      ) => {
        publishedOp = op;
        cb(null);
      },
    } as Pick<PubSub, 'publish'>;

    const backend = {
      connect: () => ({
        get: () => ({
          version: 7,
          data: { id: 'fld_id', type: 'singleLineText' },
          fetch: (cb: (error?: unknown) => void) => cb(),
        }),
        close: () => undefined,
      }),
    };

    const publisher = new ShareDbPubSubPublisher(pubsub, backend);
    const result = await publisher.publish(['fld_tbl'], {
      c: 'fld_tbl',
      d: 'fld_id',
      v: 0,
      src: 'req',
      seq: 1,
      op: [{ p: ['type'], oi: 'singleSelect' }],
    } as never);

    expect(result.isOk()).toBe(true);
    expect((publishedOp as { v?: number }).v).toBe(7);
    expect((publishedOp as { op?: unknown[] }).op).toEqual([
      { p: ['type'], oi: 'singleSelect', od: 'singleLineText' },
    ]);
  });

  it('falls back to original version when backend fetch fails', async () => {
    let publishedOp: unknown;
    const pubsub = {
      publish: (
        _channels: string[],
        op: { [k: string]: unknown },
        cb: (error: Error | null) => void
      ) => {
        publishedOp = op;
        cb(null);
      },
    } as Pick<PubSub, 'publish'>;

    const backend = {
      connect: () => ({
        get: () => ({
          version: 7,
          fetch: (cb: (error?: unknown) => void) => cb(new Error('fetch failed')),
        }),
        close: () => undefined,
      }),
    };

    const publisher = new ShareDbPubSubPublisher(pubsub, backend);
    const result = await publisher.publish(['fld_tbl'], {
      c: 'fld_tbl',
      d: 'fld_id',
      v: 0,
      src: 'req',
      seq: 1,
      op: [{ p: ['type'], oi: 'singleSelect' }],
    } as never);

    expect(result.isOk()).toBe(true);
    expect((publishedOp as { v?: number }).v).toBe(0);
  });
});
