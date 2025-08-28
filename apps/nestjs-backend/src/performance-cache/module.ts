import { Module } from '@nestjs/common';
import { PerformanceCacheService } from './service';

/**
 * Performance Cache Module
 *
 * Provides Redis-based performance caching service, supporting:
 * 1. Generic cache read/write operations
 * 2. Decorator-based automatic caching
 * 3. Batch operation support
 * 4. Cache statistics and monitoring
 *
 * Environment variables:
 * - BACKEND_CACHE_REDIS_URI: Redis connection URI (enables performance cache when set)
 *
 * @example
 * ```typescript
 * // Usage in service
 * @Injectable()
 * class UserService {
 *   constructor(
 *     private readonly performanceCacheService: PerformanceCacheService
 *   ) {}
 *
 *   // Manual cache control
 *   async getUserData(userId: string) {
 *     const cacheKey = `user:${userId}:data`;
 *
 *     // Try to get from cache
 *     const cached = await this.performanceCacheService.get(cacheKey);
 *     if (cached) {
 *       return cached;
 *     }
 *
 *     // Fetch data and cache
 *     const data = await this.fetchUserData(userId);
 *     await this.performanceCacheService.set(cacheKey, data, { ttl: 300 });
 *     return data;
 *   }
 *
 *   // Use decorator for automatic caching
 *   @PerformanceCache({ ttl: 600, perUser: true })
 *   async getExpensiveData() {
 *     return this.performExpensiveCalculation();
 *   }
 * }
 * ```
 */
@Module({
  providers: [PerformanceCacheService],
  exports: [PerformanceCacheService],
})
export class PerformanceCacheModule {}
