/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { generateServiceCacheKey } from './generate-keys';
import { PerformanceCacheService } from './service';
import type { ICacheDecoratorOptions } from './types';

/**
 * Default values for performance cache decorator options
 */
const DEFAULT_OPTIONS: Partial<ICacheDecoratorOptions> = {
  ttl: 300, // 5 minutes
  skipGet: false,
  skipSet: false,
  preventConcurrent: false, // disable concurrent prevention by default
};

/**
 * Performance cache decorator
 * Automatically adds caching functionality to methods
 *
 * @param options Cache options
 * @returns Decorator function
 *
 * @example
 * ```typescript
 * // Basic usage
 * class UserService {
 *   @PerformanceCache({ ttl: 600 })
 *   async getUserById(userId: string) {
 *     return this.userRepository.findById(userId);
 *   }
 *
 *   // Custom key generator
 *   @PerformanceCache({
 *     keyGenerator: (tableId, filters) => `table:${tableId}:${JSON.stringify(filters)}`
 *   })
 *   async getTableData(tableId: string, filters: any) {
 *     return this.queryTableData(tableId, filters);
 *   }
 *
 *   // Conditional cache
 *   @PerformanceCache({
 *     condition: (useCache) => useCache === true,
 *     ttl: 600
 *   })
 *   async getExpensiveData(data: any, useCache = false) {
 *     return this.calculateExpensiveData(data);
 *   }
 * }
 * ```
 */
export function PerformanceCache(options: ICacheDecoratorOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const finalOptions = { ...DEFAULT_OPTIONS, ...options };

    descriptor.value = async function (...args: any[]) {
      // Get dependency injected service
      const cacheService = getInjectedService(
        this,
        PerformanceCacheService,
        finalOptions.cacheServiceName
      );

      if (!cacheService) {
        throw new Error(
          `PerformanceCacheService is not available in ${target.constructor.name}.${propertyKey}`
        );
      }

      // Check condition function
      if (finalOptions.condition && !finalOptions.condition(...args)) {
        return originalMethod.apply(this, args);
      }

      // Generate cache key
      const cacheKey = generateCacheKey(target.constructor.name, propertyKey, args, finalOptions);

      // Wrap original method execution
      return cacheService.wrap(cacheKey as any, () => originalMethod.apply(this, args), {
        ttl: finalOptions.ttl,
        skipGet: finalOptions.skipGet,
        skipSet: finalOptions.skipSet,
        preventConcurrent: finalOptions.preventConcurrent,
        statsType: finalOptions.statsType,
      });
    };

    return descriptor;
  };
}

/**
 * Generate cache key
 */
function generateCacheKey(
  className: string,
  methodName: string,
  args: any[],
  options: ICacheDecoratorOptions
): string {
  // If custom key generator is provided
  if (options.keyGenerator) {
    return options.keyGenerator(...args);
  }

  // Default key generation logic
  return generateServiceCacheKey(className, methodName, args);
}

/**
 * Get dependency injected service instance
 */
function getInjectedService<T>(
  instance: any,
  serviceClass: new (...args: any[]) => T,
  cacheServiceName?: string
): T | null {
  try {
    // Try to get service from instance
    const serviceName = serviceClass.name;
    const defaultName = cacheServiceName
      ? cacheServiceName
      : serviceName.charAt(0).toLowerCase() + serviceName.slice(1);
    if (instance[defaultName] instanceof serviceClass) {
      return instance[defaultName];
    }

    return null;
  } catch (error) {
    return null;
  }
}
