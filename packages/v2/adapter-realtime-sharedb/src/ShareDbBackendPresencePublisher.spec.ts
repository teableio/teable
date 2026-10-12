import { NoopLogger, type ILogger } from '@teable/v2-core';
import type ShareDbClass from 'sharedb';
import { describe, expect, it, vi } from 'vitest';

import { ShareDbBackendPresencePublisher } from './ShareDbBackendPresencePublisher';

type FakeLocal = {
  presenceId: string;
  submitted: unknown[];
  submit: (data: unknown, callback?: (error?: unknown) => void) => void;
};

type FakeConnection = {
  locals: Map<string, FakeLocal>;
  close: ReturnType<typeof vi.fn>;
};

const createFakeBackend = () => {
  const connections: FakeConnection[] = [];
  const backend = {
    connect: vi.fn(() => {
      const locals = new Map<string, FakeLocal>();
      const connection = {
        getPresence: (channel: string) => ({
          create: (presenceId: string) => {
            const local: FakeLocal = {
              presenceId,
              submitted: [],
              submit: (data, callback) => {
                local.submitted.push(data);
                callback?.(undefined);
              },
            };
            locals.set(channel, local);
            return local;
          },
        }),
        close: vi.fn(),
      };
      connections.push({ locals, close: connection.close });
      return connection;
    }),
  };
  return { backend: backend as unknown as ShareDbClass, connections };
};

const createLogger = () => {
  const logger = {
    child: vi.fn(),
    scope: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ILogger;
  vi.mocked(logger.scope).mockReturnValue(logger);
  return logger;
};

describe('ShareDbBackendPresencePublisher', () => {
  it('reuses one connection and one local presence per channel', async () => {
    const { backend, connections } = createFakeBackend();
    const publisher = new ShareDbBackendPresencePublisher(backend, new NoopLogger());

    await publisher.publish('ch-a', [{ actionKey: 'first' }]);
    await publisher.publish('ch-a', [{ actionKey: 'second' }]);

    expect(connections).toHaveLength(1);
    expect(connections[0].locals.size).toBe(1);
    const local = connections[0].locals.get('ch-a');
    expect(local?.presenceId.startsWith('ch-a#')).toBe(true);
    expect(local?.submitted).toEqual([[{ actionKey: 'first' }], [{ actionKey: 'second' }]]);
  });

  it('recycles the backend connection at the channel cap so backend presence state is released', async () => {
    const { backend, connections } = createFakeBackend();
    const publisher = new ShareDbBackendPresencePublisher(backend, new NoopLogger(), {
      maxCachedChannels: 2,
    });

    await publisher.publish('ch-a', []);
    await publisher.publish('ch-b', []);
    expect(connections).toHaveLength(1);

    await publisher.publish('ch-c', []);

    expect(connections).toHaveLength(2);
    expect(connections[0].close).toHaveBeenCalledTimes(1);
    expect(connections[1].locals.size).toBe(1);
    const firstId = connections[0].locals.get('ch-a')?.presenceId.split('#')[1];
    const recycledId = connections[1].locals.get('ch-c')?.presenceId.split('#')[1];
    expect(recycledId).toBeDefined();
    expect(recycledId).not.toBe(firstId);
  });

  it('settles best effort when the presence submit never acknowledges', async () => {
    const logger = createLogger();
    const backend = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({ presenceId: 'p', submit: () => undefined }),
        }),
        close: vi.fn(),
      }),
    } as unknown as ShareDbClass;
    const publisher = new ShareDbBackendPresencePublisher(backend, logger, {
      publishTimeoutMs: 20,
    });

    const result = await publisher.publish('ch-slow', []);

    expect(result.isOk()).toBe(true);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('presence signal timed out', {
      channel: 'ch-slow',
    });
  });

  it('logs and settles when the presence submit fails', async () => {
    const logger = createLogger();
    const backend = {
      connect: () => ({
        getPresence: () => ({
          create: () => ({
            presenceId: 'p',
            submit: (_data: unknown, callback?: (error?: unknown) => void) =>
              callback?.(new Error('submit failed')),
          }),
        }),
        close: vi.fn(),
      }),
    } as unknown as ShareDbClass;
    const publisher = new ShareDbBackendPresencePublisher(backend, logger);

    const result = await publisher.publish('ch-fail', []);

    expect(result.isOk()).toBe(true);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith('presence signal failed', {
      channel: 'ch-fail',
      error: 'submit failed',
    });
  });
});
