/* eslint-disable @typescript-eslint/naming-convention */
import type { IPickUserMe } from '../features/auth/utils';

/**
 * Performance cache key-value store interface
 * Used to define data types that can be stored in performance cache
 */
export interface IPerformanceCacheStore {
  // record cache, format: record:path:table_id:version:query_hash
  [key: `record:${string}:${string}:${string}:${string}`]: unknown;

  // Aggregation result cache, format: agg:path:table_id:version:query_hash
  [key: `agg:${string}:${string}:${string}:${string}`]: unknown;

  // Service method cache, format: service:class_name:method:params_hash
  [key: `service:${string}:${string}:${string}`]: unknown;

  // user cache, format: user:user_id
  [key: `user:${string}`]: IPickUserMe & { deactivatedTime: string | null };

  // collaborator cache, format: collaborator:resource_id
  [key: `collaborator:${string}`]: unknown;

  // access token cache, format: access-token:id
  [key: `access-token:${string}`]: unknown;

  // integration cache, format: integration:space_id
  [key: `integration:${string}`]: unknown;

  // instance setting cache, format: instance:setting
  'instance:setting': unknown;
}

/**
 * Cache options interface
 */
export interface ICacheOptions {
  /** Cache expiration time (seconds) */
  ttl?: number;
  /** Whether to skip cache reading (write only) */
  skipGet?: boolean;
  /** Whether to skip cache writing (read only) */
  skipSet?: boolean;
  /** Whether to prevent concurrent cache generation for same key (default: true) */
  preventConcurrent?: boolean;
  /** Performance prefix */
  statsType?: string;
}

/**
 * Cache decorator options
 */
export interface ICacheDecoratorOptions extends ICacheOptions {
  /** Cache key generation function, uses default parameter hash if not provided */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyGenerator?: (...args: any[]) => string;
  /** Condition function, skip cache when returns false */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  condition?: (...args: any[]) => boolean;
  /** Cache service name, if not provided, use the default name: performanceCacheService */
  cacheServiceName?: string;
}

/**
 * Cache statistics
 */
export interface ICacheStats {
  /** Hit count */
  hits: number;
  /** Miss count */
  misses: number;
  /** Set count */
  sets: number;
  /** Delete count */
  deletes: number;
  /** Error count */
  errors: number;
}
