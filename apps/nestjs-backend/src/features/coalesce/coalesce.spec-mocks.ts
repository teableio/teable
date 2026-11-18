import { CoalesceService, type ICoalesceFlushJob } from './coalesce.service';

/**
 * The shared state every pod's CoalesceService sees, faked in memory: a cache whose entries
 * expire on the (fake) clock, a lock that always grants, and a queue whose delayed jobs run
 * on timers, a failed one again after its backoff. `vi.clearAllTimers()` loses every booked
 * job, as a dead queue would, and `failNextBooking()` makes the next booking throw, as an
 * unreachable queue would. `bookings` counts the jobs booked.
 */
export const createCoalesceBackend = () => {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  const read = (key: string) => {
    const entry = store.get(key);
    return structuredClone(entry && Date.now() < entry.expiresAt ? entry.value : undefined);
  };
  const cacheService = {
    get: async (key: string) => read(key),
    getMany: async (keys: string[]) => keys.map(read),
    setDetail: async (key: string, value: unknown, ttlSeconds: number) => {
      store.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    del: async (key: string) => store.delete(key),
  };
  const distributedLockService = {
    runExclusive: async (_name: string, _ttl: number, task: () => Promise<void>) => {
      await task();
      return true;
    },
  };
  let bookingFails = false;
  let bookings = 0;
  const failNextBooking = () => {
    bookingFails = true;
  };
  /** One pod's service; its booked flushes run on that pod. */
  const createService = () => {
    const queue = {
      add: async (
        _name: string,
        job: ICoalesceFlushJob,
        options: { delay: number; attempts: number; backoff: { delay: number } }
      ) => {
        if (bookingFails) {
          bookingFails = false;
          throw new Error('queue unreachable');
        }
        bookings++;
        const run = (attempt: number, delay: number) =>
          setTimeout(
            () =>
              void service.flush(job, attempt >= options.attempts).catch(() => {
                if (attempt < options.attempts) {
                  run(attempt + 1, options.backoff.delay * 2 ** (attempt - 1));
                }
              }),
            delay
          );
        run(1, options.delay);
      },
    };
    const service = new CoalesceService(
      cacheService as never,
      distributedLockService as never,
      queue as never
    );
    return service;
  };
  return {
    createService,
    failNextBooking,
    get bookings() {
      return bookings;
    },
  };
};
