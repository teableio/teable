import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

@Injectable()
export class CacheMetricsService {
  private readonly meter = metrics.getMeter('teable-observability');

  private readonly cacheHits = this.meter.createCounter('performance.cache.hit', {
    description: 'Performance cache hit count',
  });
  private readonly cacheMisses = this.meter.createCounter('performance.cache.miss', {
    description: 'Performance cache miss count',
  });
  private readonly cacheGetTime = this.meter.createHistogram('performance.cache.get.time', {
    description: 'Performance cache get time in milliseconds',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [1, 2, 5, 10, 25, 50, 75, 100],
    },
  });
  private readonly cacheHitRate = this.meter.createGauge('performance.cache.hit.rate', {
    description: 'Performance cache hit rate percentage',
    unit: '%',
  });

  recordHit(cacheType: string, attributes?: Record<string, string>): void {
    this.cacheHits.add(1, {
      cache_type: cacheType,
      ...attributes,
    });
  }

  recordMiss(cacheType: string, attributes?: Record<string, string>): void {
    this.cacheMisses.add(1, {
      cache_type: cacheType,
      ...attributes,
    });
  }

  recordGetTime(cacheType: string, durationMs: number, attributes?: Record<string, string>): void {
    this.cacheGetTime.record(durationMs, {
      cache_type: cacheType,
      ...attributes,
    });
  }

  recordHitRate(cacheType: string, hitRate: number, attributes?: Record<string, string>): void {
    this.cacheHitRate.record(hitRate, {
      cache_type: cacheType,
      ...attributes,
    });
  }
}
