import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ComputedOutboxBaseAdmissionLeaseLostError,
  ComputedOutboxBaseAdmissionService,
} from './computed-outbox-base-admission.service';

type RedisScriptState = {
  expiresAt?: number;
  now: number;
  owner?: string;
};

const runAdmissionScript = (script: string, state: RedisScriptState, args: unknown[]): number => {
  if (script.includes("redis.call('ZREMRANGEBYSCORE'")) {
    if (state.expiresAt !== undefined && state.expiresAt <= state.now) {
      state.expiresAt = undefined;
      state.owner = undefined;
    }
    if (state.expiresAt !== undefined) return 0;
    state.owner = String(args[2]);
    state.expiresAt = state.now + Number(args[0]);
    return 1;
  }
  if (script.includes("redis.call('ZSCORE'")) {
    if (state.owner !== args[0] || state.expiresAt === undefined) return 0;
    if (state.expiresAt <= state.now) {
      state.expiresAt = undefined;
      state.owner = undefined;
      return 0;
    }
    state.expiresAt = state.now + Number(args[1]);
    return 1;
  }
  if (state.owner !== args[0]) return 0;
  state.expiresAt = undefined;
  state.owner = undefined;
  return 1;
};

describe('ComputedOutboxBaseAdmissionService', () => {
  const evalRedis = vi.fn();
  const createService = () =>
    new ComputedOutboxBaseAdmissionService({ client: { eval: evalRedis } } as never);
  const previousQueuePrefix = process.env.BACKEND_QUEUE_PREFIX;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKEND_QUEUE_PREFIX = 'test-queue';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousQueuePrefix === undefined) delete process.env.BACKEND_QUEUE_PREFIX;
    else process.env.BACKEND_QUEUE_PREFIX = previousQueuePrefix;
  });

  it('rejects excess work without running it', async () => {
    evalRedis.mockResolvedValue(0);
    const operation = vi.fn();

    await expect(createService().runWithPermit('bse123', operation)).resolves.toEqual({
      admitted: false,
    });

    expect(operation).not.toHaveBeenCalled();
    expect(evalRedis).toHaveBeenCalledOnce();
    expect(evalRedis.mock.calls[0].slice(1, 3)).toEqual([
      1,
      'test-queue:v2-computed-outbox-wakeup:admission:{bse123}',
    ]);
  });

  it('fails closed when Redis acquisition fails', async () => {
    const redisError = new Error('Redis unavailable');
    const operation = vi.fn();
    evalRedis.mockRejectedValue(redisError);

    await expect(createService().runWithPermit('bse123', operation)).rejects.toBe(redisError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('releases its owned permit after successful work', async () => {
    evalRedis.mockResolvedValue(1);

    await expect(createService().runWithPermit('bse123', async () => 'done')).resolves.toEqual({
      admitted: true,
      value: 'done',
    });

    expect(evalRedis).toHaveBeenCalledTimes(2);
    expect(evalRedis.mock.calls[1].slice(1, 3)).toEqual([
      1,
      'test-queue:v2-computed-outbox-wakeup:admission:{bse123}',
    ]);
    expect(evalRedis.mock.calls[1].slice(3)).toEqual([expect.any(String)]);
  });

  it('releases its owned permit when work throws', async () => {
    evalRedis.mockResolvedValue(1);
    const error = new Error('boom');

    await expect(
      createService().runWithPermit('bse123', async () => {
        throw error;
      })
    ).rejects.toBe(error);

    expect(evalRedis).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect an owner whose Redis lease has expired', async () => {
    vi.useFakeTimers();
    const state: RedisScriptState = { now: 1_000 };
    evalRedis.mockImplementation((script, _keyCount, _key, ...args) =>
      runAdmissionScript(script, state, args)
    );
    const operationGate = Promise.withResolvers<void>();
    const result = createService().runWithPermit('bse123', async (permit) => {
      await operationGate.promise;
      permit.assertActive();
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.expiresAt).toBe(31_000);

    state.now = 31_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.owner).toBeUndefined();
    expect(state.expiresAt).toBeUndefined();

    operationGate.resolve();
    await expect(result).rejects.toBeInstanceOf(ComputedOutboxBaseAdmissionLeaseLostError);
  });

  it('renews only its unexpired existing lease using Redis time', async () => {
    vi.useFakeTimers();
    evalRedis.mockResolvedValue(1);
    let finish: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const result = createService().runWithPermit('bse123', () => operation);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(evalRedis).toHaveBeenCalledTimes(2);
    const [renewScript, renewKeyCount, renewKey, ...renewArgs] = evalRedis.mock.calls[1];
    expect(renewScript).toContain("redis.call('ZSCORE', key, owner)");
    expect(renewScript).toContain("redis.call('TIME')");
    expect(renewScript).toContain('if tonumber(expiresAt) <= now then');
    expect(renewScript.indexOf('if tonumber(expiresAt) <= now then')).toBeLessThan(
      renewScript.indexOf("redis.call('ZADD', key, 'XX'")
    );
    expect(renewScript).not.toContain('renewBefore');
    expect(renewKeyCount).toBe(1);
    expect(renewKey).toBe('test-queue:v2-computed-outbox-wakeup:admission:{bse123}');
    expect(renewArgs).toEqual([expect.any(String), 30_000]);

    finish?.();
    await result;
    expect(evalRedis).toHaveBeenCalledTimes(3);
  });

  it('fails the operation after renewal reports ownership loss', async () => {
    vi.useFakeTimers();
    evalRedis.mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    let finish: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const result = createService().runWithPermit('bse123', async (permit) => {
      await operation;
      permit.assertActive();
    });

    await vi.advanceTimersByTimeAsync(10_000);
    finish?.();

    await expect(result).rejects.toBeInstanceOf(ComputedOutboxBaseAdmissionLeaseLostError);
    expect(evalRedis).toHaveBeenCalledTimes(3);
  });

  it('fails the operation after renewal throws', async () => {
    vi.useFakeTimers();
    const renewError = new Error('Redis unavailable');
    evalRedis.mockResolvedValueOnce(1).mockRejectedValueOnce(renewError).mockResolvedValueOnce(1);
    let finish: (() => void) | undefined;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const result = createService().runWithPermit('bse123', async (permit) => {
      await operation;
      permit.assertActive();
    });

    await vi.advanceTimersByTimeAsync(10_000);
    finish?.();

    await expect(result).rejects.toMatchObject({
      name: 'ComputedOutboxBaseAdmissionLeaseLostError',
      cause: renewError,
    });
    expect(evalRedis).toHaveBeenCalledTimes(3);
  });

  it('fails the operation when renewal does not settle', async () => {
    vi.useFakeTimers();
    const stalledRenewal = Promise.withResolvers<never>();
    evalRedis
      .mockResolvedValueOnce(1)
      .mockReturnValueOnce(stalledRenewal.promise)
      .mockResolvedValueOnce(1);
    const operationGate = Promise.withResolvers<void>();
    const result = createService().runWithPermit('bse123', async (permit) => {
      await operationGate.promise;
      permit.assertActive();
    });

    await vi.advanceTimersByTimeAsync(15_000);
    operationGate.resolve();

    await expect(result).rejects.toMatchObject({
      name: 'ComputedOutboxBaseAdmissionLeaseLostError',
      cause: expect.objectContaining({
        message: 'Computed outbox base admission renewal timed out',
      }),
    });
    expect(evalRedis).toHaveBeenCalledTimes(3);
  });

  it('uses Redis time and removes expired owners before checking capacity', async () => {
    evalRedis.mockResolvedValue(0);

    await createService().runWithPermit('bse123', vi.fn());

    const [acquireScript, keyCount, key, ...acquireArgs] = evalRedis.mock.calls[0];
    expect(acquireScript).toContain("redis.call('TIME')");
    expect(acquireScript).toContain("redis.call('ZREMRANGEBYSCORE', key, '-inf', now)");
    expect(acquireScript.indexOf('ZREMRANGEBYSCORE')).toBeLessThan(
      acquireScript.indexOf("redis.call('ZCARD', key)")
    );
    expect(keyCount).toBe(1);
    expect(key).toBe('test-queue:v2-computed-outbox-wakeup:admission:{bse123}');
    expect(acquireArgs).toEqual([30_000, 2, expect.any(String)]);
  });

  it('stops local work after the last Redis-confirmed lease even when renewal stalls', async () => {
    vi.useFakeTimers();
    const stalledRenewal = Promise.withResolvers<never>();
    evalRedis
      .mockResolvedValueOnce(1)
      .mockReturnValueOnce(stalledRenewal.promise)
      .mockResolvedValueOnce(1);
    let permit: Parameters<Parameters<ComputedOutboxBaseAdmissionService['runWithPermit']>[1]>[0];
    const operationGate = Promise.withResolvers<void>();
    const result = createService().runWithPermit('bse123', async (activePermit) => {
      permit = activePermit;
      await operationGate.promise;
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(() => permit.assertActive()).toThrow(ComputedOutboxBaseAdmissionLeaseLostError);

    operationGate.resolve();
    await expect(result).rejects.toBeInstanceOf(ComputedOutboxBaseAdmissionLeaseLostError);
  });

  it('uses the BullMQ queue client independently of the configured backend cache provider', async () => {
    const previousCacheProvider = process.env.BACKEND_CACHE_PROVIDER;
    process.env.BACKEND_CACHE_PROVIDER = 'memory';
    evalRedis.mockResolvedValue(1);

    try {
      await expect(createService().runWithPermit('bse123', async () => 'done')).resolves.toEqual({
        admitted: true,
        value: 'done',
      });
    } finally {
      if (previousCacheProvider === undefined) delete process.env.BACKEND_CACHE_PROVIDER;
      else process.env.BACKEND_CACHE_PROVIDER = previousCacheProvider;
    }

    expect(evalRedis).toHaveBeenCalledTimes(2);
  });
});
