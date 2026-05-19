import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';

export const DATA_DB_KNEX_CACHE_NAMESPACE = 'data-db:knex';
export const DATA_DB_PRISMA_CACHE_NAMESPACE = 'data-db:prisma';
export const V2_CONTAINER_CACHE_NAMESPACE = 'v2:container';

type DestroyFn<T> = (value: T) => Promise<void> | void;
type UnknownDestroyFn = (value: unknown) => Promise<void> | void;

interface ICacheEntry {
  namespace: string;
  key: string;
  promise: Promise<unknown>;
  value?: unknown;
  destroy: UnknownDestroyFn;
}

const resolveMaxEntries = () => {
  const raw = Number(process.env.BYODB_RUNTIME_CACHE_MAX ?? 50);
  return Number.isInteger(raw) && raw > 0 ? raw : 50;
};

@Injectable()
export class DataDbRuntimeCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(DataDbRuntimeCacheService.name);
  private readonly entries = new Map<string, ICacheEntry>();
  private readonly maxEntries = resolveMaxEntries();

  async getOrCreate<T>(
    namespace: string,
    key: string,
    create: () => Promise<T> | T,
    destroy: DestroyFn<T>
  ): Promise<T> {
    const cacheKey = this.getCacheKey(namespace, key);
    const existing = this.entries.get(cacheKey);
    if (existing) {
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, existing);
      return (await existing.promise) as T;
    }

    const entry: ICacheEntry = {
      namespace,
      key,
      destroy: (value) => destroy(value as T),
      promise: Promise.resolve(undefined),
    };

    entry.promise = Promise.resolve()
      .then(create)
      .then((value) => {
        entry.value = value;
        return value;
      })
      .catch((error) => {
        this.entries.delete(cacheKey);
        throw error;
      });

    this.entries.set(cacheKey, entry);
    await this.evictIfNeeded();
    return (await entry.promise) as T;
  }

  async delete(namespace: string, key: string) {
    const cacheKey = this.getCacheKey(namespace, key);
    const entry = this.entries.get(cacheKey);
    if (!entry) return;

    this.entries.delete(cacheKey);
    await this.destroyEntry(entry);
  }

  async deleteByNamespace(namespace: string) {
    const entries = Array.from(this.entries.entries()).filter(
      ([, entry]) => entry.namespace === namespace
    );
    await Promise.all(
      entries.map(async ([cacheKey, entry]) => {
        this.entries.delete(cacheKey);
        await this.destroyEntry(entry);
      })
    );
  }

  async deleteByKey(key: string) {
    const entries = Array.from(this.entries.entries()).filter(([, entry]) => entry.key === key);
    await Promise.all(
      entries.map(async ([cacheKey, entry]) => {
        this.entries.delete(cacheKey);
        await this.destroyEntry(entry);
      })
    );
  }

  get size() {
    return this.entries.size;
  }

  private async evictIfNeeded() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.entries().next().value as [string, ICacheEntry] | undefined;
      if (!oldest) return;

      const [cacheKey, entry] = oldest;
      this.entries.delete(cacheKey);
      await this.destroyEntry(entry);
    }
  }

  private async destroyEntry(entry: ICacheEntry) {
    try {
      const value = entry.value ?? (await entry.promise.catch(() => undefined));
      if (value != null) {
        await entry.destroy(value);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to destroy cached data DB runtime ${entry.namespace}:${entry.key}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private getCacheKey(namespace: string, key: string) {
    return `${namespace}:${key}`;
  }

  async onModuleDestroy() {
    const entries = Array.from(this.entries.entries());
    this.entries.clear();
    await Promise.all(entries.map(([, entry]) => this.destroyEntry(entry)));
  }
}
