import { describe, expect, it } from 'vitest';
import type { PubSub } from 'sharedb';

import { ShareDbPubSubPublisher } from './ShareDbPubSubPublisher';

describe('ShareDbPubSubPublisher', () => {
  it('publishes op without mutating payload', async () => {
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

    const publisher = new ShareDbPubSubPublisher(pubsub);
    const result = await publisher.publish(['fld_tbl'], {
      c: 'fld_tbl',
      d: 'fld_id',
      v: 0,
      src: 'req',
      seq: 1,
      op: [{ p: ['type'], oi: 'singleSelect', od: 'singleLineText' }],
    } as never);

    expect(result.isOk()).toBe(true);
    expect((publishedOp as { v?: number }).v).toBe(0);
    expect((publishedOp as { op?: unknown[] }).op).toEqual([
      { p: ['type'], oi: 'singleSelect', od: 'singleLineText' },
    ]);
  });

  it('returns err when pubsub publish fails', async () => {
    const pubsub = {
      publish: (
        _channels: string[],
        _op: { [k: string]: unknown },
        cb: (error: Error | null) => void
      ) => {
        cb(new Error('publish failed'));
      },
    } as Pick<PubSub, 'publish'>;

    const publisher = new ShareDbPubSubPublisher(pubsub);
    const result = await publisher.publish(['fld_tbl'], {
      c: 'fld_tbl',
      d: 'fld_id',
      v: 0,
      src: 'req',
      seq: 1,
      op: [{ p: ['type'], oi: 'singleSelect' }],
    } as never);

    expect(result.isErr()).toBe(true);
  });
});
