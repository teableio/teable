import * as os from 'os';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BatchObservableCallback, Observable } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';

/**
 * Exports process-level memory as observable gauges, completing the picture
 * RuntimeNodeInstrumentation leaves open: that instrumentation covers V8 heap
 * per space (v8js.memory.heap.*) but not RSS/external/arrayBuffers, and the
 * RSS-vs-heap gap is exactly what matters when investigating resident memory.
 *
 * Unlike the rest of the metrics pipeline, these gauges carry a `pod`
 * attribute: tracing.ts deliberately strips per-instance resource attributes
 * to cap cardinality, but memory investigation needs per-pod series (without
 * it the pods' samples collide on one series). Cost model: the live sample
 * rate is constant (5 gauges x live pods), while series accumulate linearly
 * with pod restarts/rollouts and age out with retention — additive on 5
 * instruments, unlike a resource attribute which would multiply every
 * instrument. Exporting also requires the metrics pipeline itself
 * (OTEL_EXPORTER_OTLP_METRICS_ENDPOINT); without a metric reader the
 * observable callbacks never fire.
 * ENV:
 * // enable memory gauges, default false
 * - ENABLE_MEMORY_METRICS=true
 */
@Injectable()
export class MemoryMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryMetricsService.name);
  private readonly meter = metrics.getMeter('teable-observability');
  private callback: BatchObservableCallback | null = null;
  private gauges: Observable[] = [];
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get('ENABLE_MEMORY_METRICS') === 'true';
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log('💤 Memory gauges disabled (set ENABLE_MEMORY_METRICS=true to enable)');
      return;
    }

    // Same identity as /health/memory so per-pod signals correlate
    const attributes = { pod: process.env.HOSTNAME || os.hostname() };
    const byteGauge = (name: string, description: string) =>
      this.meter.createObservableGauge(name, { description, unit: 'By' });

    const rss = byteGauge('process.memory.usage', 'Resident set size of the process');
    const heapTotal = byteGauge('nodejs.memory.heap.total', 'Total size of the V8 heap');
    const heapUsed = byteGauge('nodejs.memory.heap.used', 'Used size of the V8 heap');
    const external = byteGauge(
      'nodejs.memory.external',
      'Memory of C++ objects bound to JS objects'
    );
    const arrayBuffers = byteGauge(
      'nodejs.memory.array_buffers',
      'Memory allocated for ArrayBuffers and SharedArrayBuffers'
    );
    this.gauges = [rss, heapTotal, heapUsed, external, arrayBuffers];

    this.callback = (result) => {
      const usage = process.memoryUsage();
      result.observe(rss, usage.rss, attributes);
      result.observe(heapTotal, usage.heapTotal, attributes);
      result.observe(heapUsed, usage.heapUsed, attributes);
      result.observe(external, usage.external, attributes);
      result.observe(arrayBuffers, usage.arrayBuffers, attributes);
    };
    this.meter.addBatchObservableCallback(this.callback, this.gauges);
  }

  onModuleDestroy() {
    if (this.callback) {
      this.meter.removeBatchObservableCallback(this.callback, this.gauges);
      this.callback = null;
    }
  }
}
