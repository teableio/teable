import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBaseNodeListCacheKey } from '../../performance-cache/generate-keys';
import { RESOURCE_DESCRIPTORS } from '../resource/resource-descriptor';
import { BaseNodeListener } from './base-node.listener';

describe('BaseNodeListener', () => {
  afterEach(() => vi.restoreAllMocks());

  const listen = () => {
    const eventEmitter = new EventEmitter2();
    const del = vi.fn();
    new BaseNodeListener(
      {} as never,
      { del } as never,
      // A closed connection stops at the cache: that is enough to see the tree was told.
      { shareDbAdapter: { closed: true } } as never,
      { get: vi.fn() } as never,
      eventEmitter
    ).onApplicationBootstrap();
    return { eventEmitter, del };
  };

  const kinds = Object.entries(RESOURCE_DESCRIPTORS).flatMap(([type, { nodeEvents }]) =>
    nodeEvents ? [{ type, ...nodeEvents }] : []
  );

  it.each(kinds)('refreshes the tree on every change to a $type', async (kind) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { eventEmitter, del } = listen();
    const key = kind.payloadKey;
    const events = [
      [kind.create, { baseId: 'bseA', [key]: { id: 'resA' } }],
      [kind.update, { baseId: 'bseA', [key]: { id: 'resA' } }],
      [kind.delete, { baseId: 'bseA', [`${key}Id`]: 'resA' }],
    ] as const;

    for (const [name, payload] of events) {
      del.mockClear();
      await eventEmitter.emitAsync(name, { name, payload, context: {} });
      await vi.waitFor(() =>
        expect(del).toHaveBeenCalledWith(generateBaseNodeListCacheKey('bseA'))
      );
    }
  });
});
