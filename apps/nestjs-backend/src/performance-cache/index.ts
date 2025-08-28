/**
 * Performance Cache Module Exports
 *
 * Provides Redis caching functionality based on BACKEND_CACHE_REDIS_URI environment variable
 *
 * Usage:
 * 1. Set environment variable:
 *  - BACKEND_CACHE_REDIS_URI=redis://localhost:6379
 *
 * 2. Import in module:
 *  ```typescript
 *  @Module({
 *    imports: [PerformanceCacheModule],
 *    // ...
 *  })
 *  ```
 *
 * 3. Use in service:
 *  ```typescript
 *  constructor(private readonly performanceCacheService: PerformanceCacheService) {}
 *
 *  // Manual cache control
 *  const cached = await this.performanceCacheService.get('key');
 *  await this.performanceCacheService.set('key', value, { ttl: 300 });
 *
 *  // Use decorator
 *  @PerformanceCache({ ttl: 600 })
 *  async myMethod() { ... }
 *  ```
 */

// Core services and modules
export { PerformanceCacheService } from './service';
export { PerformanceCacheModule } from './module';

// Decorators
export { PerformanceCache, CacheKey } from './decorator';

// Type definitions
export type {
  IPerformanceCacheStore,
  ICacheOptions,
  ICacheDecoratorOptions,
  ICacheStats,
} from './types';
