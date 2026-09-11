import { createHash } from 'node:crypto';

// Compute-activity polls from every viewer of a table are identical work: the
// snapshot is a projection of the shared computed_*_activity rows, not per-user
// state. Measured on CN production (2026-09-10) the endpoint was 29-32% of all
// requests a pod served at ~2.4 rps/pod, and 52% of those polls repeated the same
// table within the same second, each repeat paying a transaction plus one
// statement-timeout round trip per query.
//
// A reused snapshot is only safe while the projection it came from is unchanged:
// the client consumes compute-activity notices up to the request it is about to
// answer, so handing it a snapshot older than that notice hides the final
// `idle` state until the fallback poll. Callers therefore pass `revalidate`,
// which the coalescer runs before serving a stored value (the reader compares its
// projection token), and `deadline`, which bounds every caller's own wait —
// including a share of another caller's in-flight read.
const DEFAULT_READ_CACHE_MS = 1_000;
const DEFAULT_READ_CACHE_MAX_ENTRIES = 5_000;

/** `COMPUTED_ACTIVITY_READ_CACHE_MS=0` disables reuse and sharing (kill switch). */
export const computedActivityReadCacheConfig = (): { ttlMs: number; maxEntries: number } => {
  const ttl = Number(process.env.COMPUTED_ACTIVITY_READ_CACHE_MS);
  const maxEntries = Number(process.env.COMPUTED_ACTIVITY_READ_CACHE_MAX_ENTRIES);
  return {
    ttlMs: Number.isFinite(ttl) && ttl >= 0 ? Math.floor(ttl) : DEFAULT_READ_CACHE_MS,
    maxEntries:
      Number.isFinite(maxEntries) && maxEntries >= 0
        ? Math.floor(maxEntries)
        : DEFAULT_READ_CACHE_MAX_ENTRIES,
  };
};

/**
 * Identity of the readable-field scope. An unrestricted reader (`undefined`) and
 * a reader with nothing readable (`[]`) produce different snapshots, so they must
 * never share an entry: coalesce by scope, never by table alone.
 */
export const computedActivityScopeKey = (readableFieldIds?: readonly string[]): string => {
  if (readableFieldIds === undefined) return 'scope:all';
  if (readableFieldIds.length === 0) return 'scope:none';
  return `scope:${createHash('sha1')
    .update([...readableFieldIds].sort().join('\u0000'))
    .digest('hex')}`;
};

/** A caller's own read budget elapsed, either waiting on its read or on a shared one. */
export class ComputedActivityReadBudgetExceededError extends Error {
  constructor() {
    super('Compute activity read budget exceeded');
    this.name = 'ComputedActivityReadBudgetExceededError';
  }
}

export type ComputedActivityReadRunOptions<TValue> = {
  shouldCache?: (value: TValue) => boolean;
  /**
   * Whether a caller that arrived later may reuse this execution's result,
   * decided by the executing caller. Defaults to `shouldCache`: a result the
   * caller refuses to store is also one a later caller must not inherit without
   * its own read.
   */
  shareable?: (value: TValue) => boolean;
  /** Must resolve true for the stored value to be served; false forces a fresh read. */
  revalidate?: (value: TValue) => Promise<boolean>;
  /** Absolute ms deadline of this caller; every wait is bounded by it. */
  deadline?: number;
};

type InFlightEntry<TValue> = {
  promise: Promise<TValue>;
  /** Set before the promise settles; undefined while it is still running. */
  shareable?: boolean;
};

/**
 * Bounded reuse of one key's value plus in-flight coalescing: concurrent callers
 * of the same key share a single execution, so a poll burst on one table costs
 * one read, while each caller still waits no longer than its own deadline.
 *
 * A joiner reuses a shared result only when the caller declared it shareable.
 * Freshness is the caller's business: a result that may predate a write the
 * joiner has already been notified about must be read again for that joiner.
 */
export class ComputedActivityReadCoalescer<TValue> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly cache = new Map<string, { expiresAt: number; value: TValue }>();
  private readonly inFlight = new Map<string, InFlightEntry<TValue>>();

  constructor(config: { ttlMs?: number; maxEntries?: number } = {}) {
    const defaults = computedActivityReadCacheConfig();
    this.ttlMs = config.ttlMs ?? defaults.ttlMs;
    this.maxEntries = config.maxEntries ?? defaults.maxEntries;
  }

  get enabled(): boolean {
    return this.ttlMs > 0 && this.maxEntries > 0;
  }

  async run(
    key: string,
    execute: () => Promise<TValue>,
    options: ComputedActivityReadRunOptions<TValue> = {}
  ): Promise<TValue> {
    if (!this.enabled) return execute();

    const { shouldCache = () => true, shareable = shouldCache, revalidate, deadline } = options;
    if (deadline !== undefined && deadline <= Date.now()) {
      throw new ComputedActivityReadBudgetExceededError();
    }

    // A joiner whose shared result was not shareable must end up owning its own
    // read: it may still take a revalidated cache hit, but it never accepts
    // another caller's in-flight result again, so a third caller that starts a
    // fresh unshareable read in between cannot be inherited either.
    let bypassInFlight = false;
    for (;;) {
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        if (cached.expiresAt > Date.now()) {
          const usable =
            revalidate === undefined
              ? true
              : await this.withinDeadline(deadline, revalidate(cached.value));
          if (usable) return cached.value;
        }
        this.cache.delete(key);
      }

      if (!bypassInFlight) {
        const inFlight = this.inFlight.get(key);
        if (inFlight !== undefined) {
          const value = await this.withinDeadline(deadline, inFlight.promise);
          if (inFlight.shareable !== false) return value;
          bypassInFlight = true;
          continue;
        }
      }

      const entry: InFlightEntry<TValue> = { promise: undefined as never };
      const pending = execute()
        .then((value) => {
          entry.shareable = shareable(value);
          if (shouldCache(value)) this.store(key, value);
          return value;
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
      entry.promise = pending;
      this.inFlight.set(key, entry);
      // The execution enforces its own budget (statement cancellation + rollback),
      // so it is returned unwrapped: racing it here would return before the
      // transaction is rolled back and the statement is cancelled.
      return pending;
    }
  }

  private async withinDeadline<T>(deadline: number | undefined, work: Promise<T>): Promise<T> {
    if (deadline === undefined) return work;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new ComputedActivityReadBudgetExceededError();
    // Executor form: `Promise.withResolvers` is outside the lib target the EE
    // typecheck compiles this package with.
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ComputedActivityReadBudgetExceededError()),
        remainingMs
      );
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private store(key: string, value: TValue): void {
    if (this.cache.size >= this.maxEntries) this.prune();
    this.cache.set(key, { expiresAt: Date.now() + this.ttlMs, value });
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size >= this.maxEntries) this.cache.clear();
  }
}
