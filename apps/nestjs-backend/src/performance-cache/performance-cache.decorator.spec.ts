/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../global/global.module';
import { PerformanceCache } from './decorator';
import { PerformanceCacheService } from './service';

// Test service with decorated methods
@Injectable()
class TestService {
  public callCount = 0; // Track method calls manually

  constructor(private readonly performanceCacheService: PerformanceCacheService) {}

  // Basic caching
  @PerformanceCache({ ttl: 300 })
  async basicMethod(value: string): Promise<string> {
    this.callCount++; // Increment call count
    return `processed-${value}`;
  }

  // With custom key generator
  @PerformanceCache({
    ttl: 300,
    keyGenerator: (userId: number, type: string) =>
      `service:TestService:customKeyMethod:${userId}:${type}`,
  })
  async customKeyMethod(userId: number, type: string): Promise<string> {
    this.callCount++;
    return `user-${userId}-data-${type}`;
  }

  // Conditional caching
  @PerformanceCache({
    ttl: 300,
    condition: (value: string, enableCache: boolean) => enableCache,
  })
  async conditionalMethod(value: string, _enableCache: boolean): Promise<string> {
    this.callCount++;
    return `conditional-${value}`;
  }

  // Method with cache key parameter
  async methodWithCacheKey(data: string): Promise<string> {
    this.callCount++;
    return `keyed-${data}`;
  }

  // Disable concurrent prevention
  @PerformanceCache({
    ttl: 300,
    preventConcurrent: false,
  })
  async noConcurrentPrevention(value: string): Promise<string> {
    this.callCount++;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return `no-concurrent-${value}`;
  }

  // Long operation with concurrent prevention
  @PerformanceCache({
    ttl: 600,
    preventConcurrent: true,
  })
  async longOperation(id: string): Promise<string> {
    this.callCount++;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return `long-result-${id}`;
  }

  // Skip options
  @PerformanceCache({
    ttl: 300,
    skipGet: false,
    skipSet: false,
  })
  async normalOperation(value: string): Promise<string> {
    this.callCount++;
    return `normal-${value}`;
  }

  // Method that throws error
  @PerformanceCache({ ttl: 300 })
  async errorMethod(): Promise<string> {
    this.callCount++;
    throw new Error('Test error');
  }

  // Helper method to get cache stats
  getCacheStats() {
    return this.performanceCacheService.getStats();
  }

  // Helper method to reset cache stats
  resetCacheStats() {
    this.performanceCacheService.resetStats();
  }

  // Helper method to clear cache (for testing)
  async clearCache() {
    // Clear all test cache patterns
    await this.performanceCacheService._clear();
    this.callCount = 0;
  }
}

describe.runIf(process.env.BACKEND_PERFORMANCE_CACHE)('Performance Cache Decorators', () => {
  let module: TestingModule;
  let testService: TestService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule],
      providers: [
        TestService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => {
              if (key === 'BACKEND_PERFORMANCE_CACHE') {
                return process.env.BACKEND_PERFORMANCE_CACHE || 'redis://localhost:6379';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    testService = module.get<TestService>(TestService);
  });

  afterEach(async () => {
    // Clean up
    testService.resetCacheStats();
    testService.clearCache();
    await module.close();
  });

  describe('@PerformanceCache Decorator', () => {
    it('should cache method results', async () => {
      vi.spyOn(testService, 'basicMethod');
      // First call
      const result1 = await testService.basicMethod('test');

      // Second call (should be cached)
      const result2 = await testService.basicMethod('test');

      expect(result1).toBe('processed-test');
      expect(result2).toBe('processed-test');
      expect(testService.callCount).toBe(1); // Only called once due to caching
    });

    it('should cache different arguments separately', async () => {
      vi.spyOn(testService, 'basicMethod');

      const result1 = await testService.basicMethod('test1');
      const result2 = await testService.basicMethod('test2');
      const result3 = await testService.basicMethod('test1'); // Should be cached

      expect(result1).toBe('processed-test1');
      expect(result2).toBe('processed-test2');
      expect(result3).toBe('processed-test1');
      expect(testService.callCount).toBe(2); // Called twice for different args
    });

    it('should use custom key generator', async () => {
      vi.spyOn(testService, 'customKeyMethod');

      const result1 = await testService.customKeyMethod(123, 'profile');
      const result2 = await testService.customKeyMethod(123, 'profile'); // Same key
      const result3 = await testService.customKeyMethod(124, 'profile'); // Different key

      expect(result1).toBe('user-123-data-profile');
      expect(result2).toBe('user-123-data-profile');
      expect(result3).toBe('user-124-data-profile');
      expect(testService.callCount).toBe(2); // Two different keys, so called twice
    });

    it('should handle conditional caching', async () => {
      vi.spyOn(testService, 'conditionalMethod');

      // With caching enabled
      const result1 = await testService.conditionalMethod('test', true);
      const result2 = await testService.conditionalMethod('test', true);

      // With caching disabled
      const result3 = await testService.conditionalMethod('test', false);
      const result4 = await testService.conditionalMethod('test', false);

      expect(result1).toBe('conditional-test');
      expect(result2).toBe('conditional-test');
      expect(result3).toBe('conditional-test');
      expect(result4).toBe('conditional-test');

      // Should be called 3 times: 1 for cached, 2 for non-cached
      expect(testService.callCount).toBe(3);
    });

    it('should not cache errors', async () => {
      vi.spyOn(testService, 'errorMethod');

      // First call should throw
      await expect(testService.errorMethod()).rejects.toThrow('Test error');

      // Second call should also throw (not cached)
      await expect(testService.errorMethod()).rejects.toThrow('Test error');

      expect(testService.callCount).toBe(2);
    });

    it('should handle concurrent requests', async () => {
      vi.spyOn(testService, 'longOperation');

      // Multiple concurrent calls
      const promises = Array.from({ length: 5 }, () =>
        testService.longOperation('concurrent-test')
      );

      const results = await Promise.all(promises);

      // All results should be the same
      expect(results.every((r) => r === results[0])).toBe(true);
      expect(results[0]).toBe('long-result-concurrent-test');

      // Should only be called once due to concurrent prevention
      expect(testService.callCount).toBe(1);

      // Check concurrent waits in stats
      const stats = testService.getCacheStats();
      expect(stats.hits).toBe(4);
    }, 10000);

    it('should allow concurrent execution when disabled', async () => {
      vi.spyOn(testService, 'noConcurrentPrevention');

      // Multiple concurrent calls with different values
      const promises = Array.from({ length: 3 }, (_, i) =>
        testService.noConcurrentPrevention(`test-${i}`)
      );

      const results = await Promise.all(promises);

      // All should execute
      expect(testService.callCount).toBe(3);
      expect(results).toEqual([
        'no-concurrent-test-0',
        'no-concurrent-test-1',
        'no-concurrent-test-2',
      ]);
    }, 10000);
  });

  describe('Performance and Statistics', () => {
    it('should update cache statistics', async () => {
      testService.resetCacheStats();

      // Generate some cache activity
      await testService.basicMethod('stats-test'); // Miss + Set
      await testService.basicMethod('stats-test'); // Hit

      const stats = testService.getCacheStats();

      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.sets).toBeGreaterThan(0);
    });

    it('should handle high concurrency correctly', async () => {
      const concurrentRequests = 10;
      const testValue = 'concurrency-test';

      const promises = Array.from({ length: concurrentRequests }, () =>
        testService.longOperation(testValue)
      );

      const startTime = Date.now();
      const results = await Promise.all(promises);
      const endTime = Date.now();

      // All results should be identical
      expect(results.every((r) => r === results[0])).toBe(true);

      // Should complete in roughly the time of one operation
      // (allowing for some overhead)
      expect(endTime - startTime).toBeLessThan(1000);

      const stats = testService.getCacheStats();
      expect(stats.hits).toBe(9);
    }, 15000);
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle cache service unavailable', async () => {
      // This test would require mocking the cache service to be unavailable
      // For now, we'll test that methods still work even if caching fails

      const result = await testService.basicMethod('fallback-test');
      expect(result).toBe('processed-fallback-test');
    });

    it('should handle invalid cache keys gracefully', async () => {
      // Test with various edge case inputs
      const testCases = ['', ' ', '\n', '\t', 'special characters', '🚀emoji'];

      for (const testCase of testCases) {
        const result = await testService.basicMethod(testCase);
        expect(result).toBe(`processed-${testCase}`);
      }
    });
  });

  describe('Configuration Options', () => {
    it('should respect TTL settings', async () => {
      // This is harder to test without waiting for expiration
      // But we can verify the method executes correctly
      const result = await testService.normalOperation('ttl-test');
      expect(result).toBe('normal-ttl-test');
    });

    it('should work with different key prefixes', async () => {
      // Methods with different configurations should work independently
      const result1 = await testService.basicMethod('prefix-test');
      const result2 = await testService.customKeyMethod(456, 'settings');

      expect(result1).toBe('processed-prefix-test');
      expect(result2).toBe('user-456-data-settings');
    });
  });
});
