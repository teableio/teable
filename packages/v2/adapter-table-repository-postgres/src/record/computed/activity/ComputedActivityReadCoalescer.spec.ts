import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  computedActivityReadCacheConfig,
  computedActivityScopeKey,
  ComputedActivityReadBudgetExceededError,
  ComputedActivityReadCoalescer,
} from './ComputedActivityReadCoalescer';

describe('ComputedActivityReadCoalescer', () => {
  it('shares one execution between concurrent callers of the same key', async () => {
    const coalescer = new ComputedActivityReadCoalescer<number>({ ttlMs: 1_000 });
    const execute = vi.fn(async () => {
      await sleep(5);
      return 42;
    });

    const values = await Promise.all([
      coalescer.run('table-a', execute),
      coalescer.run('table-a', execute),
      coalescer.run('table-a', execute),
    ]);

    expect(values).toEqual([42, 42, 42]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('serves the cached value inside the TTL and re-reads after it', async () => {
    const coalescer = new ComputedActivityReadCoalescer<number>({ ttlMs: 25 });
    let reads = 0;
    const execute = async () => ++reads;

    expect(await coalescer.run('table-a', execute)).toBe(1);
    expect(await coalescer.run('table-a', execute)).toBe(1);
    await sleep(40);
    expect(await coalescer.run('table-a', execute)).toBe(2);
  });

  it('keeps field scopes separate so one user never reads another scope', async () => {
    const coalescer = new ComputedActivityReadCoalescer<string>({ ttlMs: 1_000 });
    const restricted = computedActivityScopeKey(['fld1']);
    const other = computedActivityScopeKey(['fld2']);
    const execute = vi.fn(async (value: string) => value);

    await coalescer.run(restricted, () => execute('restricted'));
    await coalescer.run(other, () => execute('other'));
    await coalescer.run(restricted, () => execute('restricted'));

    expect(execute).toHaveBeenCalledTimes(2);
    expect(computedActivityScopeKey(undefined)).not.toBe(computedActivityScopeKey([]));
    expect(computedActivityScopeKey(['fld2', 'fld1'])).toBe(
      computedActivityScopeKey(['fld1', 'fld2'])
    );
  });

  it('never caches values the caller rejects as failures', async () => {
    const coalescer = new ComputedActivityReadCoalescer<{ ok: boolean }>({ ttlMs: 1_000 });
    let reads = 0;
    const execute = async () => ({ ok: ++reads > 1 });
    const shouldCache = (value: { ok: boolean }) => value.ok;

    const failed = await coalescer.run('table-a', execute, { shouldCache });
    const retried = await coalescer.run('table-a', execute, { shouldCache });
    const cached = await coalescer.run('table-a', execute, { shouldCache });

    expect(failed).toEqual({ ok: false });
    expect(retried).toEqual({ ok: true });
    expect(cached).toEqual({ ok: true });
    expect(reads).toBe(2);
  });

  it('re-runs for a joiner when the shared result is not shareable', async () => {
    const coalescer = new ComputedActivityReadCoalescer<{ token: string | undefined }>({
      ttlMs: 1_000,
    });
    const slow = Promise.withResolvers<{ token: string | undefined }>();
    // Shareability belongs to the execution, so the executing caller decides it.
    const options = {
      shouldCache: (value: { token: string | undefined }) => value.token !== undefined,
      shareable: (value: { token: string | undefined }) => value.token !== undefined,
    };
    const executed: string[] = [];
    const owner = coalescer.run(
      'table-a',
      async () => {
        executed.push('owner');
        return slow.promise;
      },
      options
    );
    const joiner = coalescer.run(
      'table-a',
      async () => {
        executed.push('joiner');
        return { token: 'fresh' };
      },
      options
    );

    slow.resolve({ token: undefined });
    expect((await owner).token).toBeUndefined();
    expect((await joiner).token).toBe('fresh');
    expect(executed).toEqual(['owner', 'joiner']);
  });

  it('never takes a second shared result after refusing an unshareable one', async () => {
    const coalescer = new ComputedActivityReadCoalescer<{ token: string | undefined }>({
      ttlMs: 1_000,
    });
    const owner = Promise.withResolvers<{ token: string | undefined }>();
    const third = Promise.withResolvers<{ token: string | undefined }>();
    const options = {
      shouldCache: (value: { token: string | undefined }) => value.token !== undefined,
      shareable: (value: { token: string | undefined }) => value.token !== undefined,
    };
    const executed: string[] = [];

    const a = coalescer.run(
      'table-a',
      async () => {
        executed.push('a');
        return owner.promise;
      },
      options
    );
    const b = coalescer.run(
      'table-a',
      async () => {
        executed.push('b');
        return { token: 'b-own' };
      },
      options
    );

    // A settles unshareable; B is scheduled to retry, but C registers its own
    // unshareable read before B's continuation runs.
    owner.resolve({ token: undefined });
    const c = coalescer.run(
      'table-a',
      async () => {
        executed.push('c');
        return third.promise;
      },
      options
    );
    third.resolve({ token: undefined });

    expect((await a).token).toBeUndefined();
    expect((await c).token).toBeUndefined();
    expect((await b).token).toBe('b-own'); // B reads for itself, it does not inherit C
    expect(executed).toEqual(['a', 'b', 'c']);
  });

  it('keeps sharing a result the caller declared shareable', async () => {
    const coalescer = new ComputedActivityReadCoalescer<string>({ ttlMs: 1_000 });
    const slow = Promise.withResolvers<string>();
    const joinerFactory = vi.fn(async () => 'joiner-own');
    const owner = coalescer.run('table-a', () => slow.promise);
    const joiner = coalescer.run('table-a', joinerFactory);

    slow.resolve('shared');
    expect(await owner).toBe('shared');
    expect(await joiner).toBe('shared');
    expect(joinerFactory).not.toHaveBeenCalled();
  });

  it('re-reads instead of serving a stored value that revalidation rejects', async () => {
    const coalescer = new ComputedActivityReadCoalescer<string>({ ttlMs: 5_000 });
    let reads = 0;
    const execute = async () => `read-${++reads}`;

    expect(await coalescer.run('table-a', execute, { revalidate: async () => true })).toBe(
      'read-1'
    );
    expect(await coalescer.run('table-a', execute, { revalidate: async () => false })).toBe(
      'read-2'
    );
    expect(await coalescer.run('table-a', execute, { revalidate: async () => true })).toBe(
      'read-2'
    );
    expect(reads).toBe(2);
  });

  it('bounds a shared read by the waiting caller own deadline', async () => {
    const coalescer = new ComputedActivityReadCoalescer<string>({ ttlMs: 1_000 });
    const slow = Promise.withResolvers<string>();
    const owner = coalescer.run('table-a', () => slow.promise);

    await expect(
      coalescer.run('table-a', async () => 'unused', { deadline: Date.now() + 25 })
    ).rejects.toBeInstanceOf(ComputedActivityReadBudgetExceededError);

    slow.resolve('owner-value');
    await expect(owner).resolves.toBe('owner-value');
  });

  it('rejects an already-expired deadline without executing the read', async () => {
    const coalescer = new ComputedActivityReadCoalescer<string>({ ttlMs: 1_000 });
    const execute = vi.fn(async () => 'value');

    await expect(
      coalescer.run('table-a', execute, { deadline: Date.now() - 1 })
    ).rejects.toBeInstanceOf(ComputedActivityReadBudgetExceededError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('bounds serving a stored value by the caller own deadline', async () => {
    const coalescer = new ComputedActivityReadCoalescer<string>({ ttlMs: 5_000 });
    await coalescer.run('table-a', async () => 'value');

    await expect(
      coalescer.run('table-a', async () => 'unused', {
        deadline: Date.now() + 20,
        revalidate: async () => {
          await sleep(200);
          return true;
        },
      })
    ).rejects.toBeInstanceOf(ComputedActivityReadBudgetExceededError);
  });

  it('clears the in-flight entry when the execution throws', async () => {
    const coalescer = new ComputedActivityReadCoalescer<number>({ ttlMs: 1_000 });
    let reads = 0;
    const execute = async () => {
      reads += 1;
      if (reads === 1) throw new Error('boom');
      return reads;
    };

    await expect(coalescer.run('table-a', execute)).rejects.toThrow('boom');
    await expect(coalescer.run('table-a', execute)).resolves.toBe(2);
  });

  it('runs every call when the cache is disabled', async () => {
    const coalescer = new ComputedActivityReadCoalescer<number>({ ttlMs: 0 });
    const execute = vi.fn(async () => 1);

    expect(coalescer.enabled).toBe(false);
    await coalescer.run('table-a', execute);
    await coalescer.run('table-a', execute);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('bounds entries, dropping expired ones first', async () => {
    const coalescer = new ComputedActivityReadCoalescer<number>({ ttlMs: 1_000, maxEntries: 2 });
    const execute = vi.fn(async () => 1);

    await coalescer.run('table-a', execute);
    await coalescer.run('table-b', execute);
    await coalescer.run('table-c', execute);
    await coalescer.run('table-a', execute);

    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('reads the env kill switch', () => {
    const previous = process.env.COMPUTED_ACTIVITY_READ_CACHE_MS;
    try {
      process.env.COMPUTED_ACTIVITY_READ_CACHE_MS = '0';
      expect(computedActivityReadCacheConfig().ttlMs).toBe(0);
      delete process.env.COMPUTED_ACTIVITY_READ_CACHE_MS;
      expect(computedActivityReadCacheConfig().ttlMs).toBe(1_000);
    } finally {
      if (previous === undefined) delete process.env.COMPUTED_ACTIVITY_READ_CACHE_MS;
      else process.env.COMPUTED_ACTIVITY_READ_CACHE_MS = previous;
    }
  });
});
