import { ok } from '@teable/v2-core';
import type { IEventBus } from '@teable/v2-core';

export const createNoopEventBus = (): IEventBus =>
  ({
    publish: async () => ok(undefined),
    publishMany: async () => ok(undefined),
    subscribe: () => ({ unsubscribe: () => undefined }),
  }) as IEventBus;
