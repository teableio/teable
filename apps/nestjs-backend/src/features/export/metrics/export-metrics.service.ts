import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

@Injectable()
export class ExportMetricsService {
  private readonly meter = metrics.getMeter('teable-observability');

  private readonly exportTotal = this.meter.createCounter('data.export.total', {
    description: 'Total number of export tasks',
  });
  private readonly exportDuration = this.meter.createHistogram('data.export.duration', {
    description: 'Export task duration in milliseconds',
    unit: 'ms',
    advice: {
      // 5s=small, 30s=medium, 60s=large, 180s=huge, 300s=timeout
      explicitBucketBoundaries: [5000, 30000, 60000, 180000, 300000],
    },
  });
  private readonly exportErrors = this.meter.createCounter('data.export.errors', {
    description: 'Total number of export errors',
  });

  recordExportStart(format: string): void {
    this.exportTotal.add(1, { format });
  }

  recordExportComplete(attrs: { format: string; durationMs: number }): void {
    this.exportDuration.record(attrs.durationMs, { format: attrs.format });
  }

  recordExportError(attrs: { format: string; errorType: string }): void {
    this.exportErrors.add(1, { format: attrs.format, error_type: attrs.errorType });
  }
}
