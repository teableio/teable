import { Injectable } from '@nestjs/common';
import { MetricsService } from '../../observability/metrics/metrics.service';
import type { IMetricsProvider } from '../../observability/metrics/providers/metrics-provider.interface';

@Injectable()
export class CacheMetricsService {
  private cacheHitsMetric!: IMetricsProvider;
  private cacheMissesMetric!: IMetricsProvider;
  private cacheGetTimeMetric!: IMetricsProvider;
  private cacheHitRateMetric!: IMetricsProvider;

  constructor(private readonly metricsService: MetricsService) {
    this.cacheHitsMetric = this.metricsService.create('performance.cache.hit', {
      description: 'Performance cache hit count',
    });
    this.cacheMissesMetric = this.metricsService.create('performance.cache.miss', {
      description: 'Performance cache miss count',
    });
    this.cacheGetTimeMetric = this.metricsService.create('performance.cache.get.time', {
      description: 'Performance cache get time in milliseconds',
      unit: 'ms',
    });
    this.cacheHitRateMetric = this.metricsService.create('performance.cache.hit.rate', {
      description: 'Performance cache hit rate percentage',
      unit: '%',
    });
  }

  recordHit(cacheType: string, attributes?: Record<string, string>): void {
    this.cacheHitsMetric.count(1, {
      cache_type: cacheType,
      ...attributes,
    });
  }

  recordMiss(cacheType: string, attributes?: Record<string, string>): void {
    this.cacheMissesMetric.count(1, {
      cache_type: cacheType,
      ...attributes,
    });
  }

  recordGetTime(cacheType: string, durationMs: number, attributes?: Record<string, string>): void {
    this.cacheGetTimeMetric.distribution(durationMs, {
      cache_type: cacheType,
      ...attributes,
    });
  }

  recordHitRate(cacheType: string, hitRate: number, attributes?: Record<string, string>): void {
    this.cacheHitRateMetric.gauge(hitRate, {
      cache_type: cacheType,
      ...attributes,
    });
  }
}
