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
      explicitBucketBoundaries: [
        1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 180000, 300000,
      ],
    },
  });
  private readonly exportRows = this.meter.createHistogram('data.export.rows', {
    description: 'Number of rows per export task',
    unit: 'rows',
    advice: {
      explicitBucketBoundaries: [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000],
    },
  });
  private readonly exportErrors = this.meter.createCounter('data.export.errors', {
    description: 'Total number of export errors',
  });

  recordExportStart(format: string): void {
    this.exportTotal.add(1, { format });
  }

  recordExportComplete(attrs: { format: string; rows: number; durationMs: number }): void {
    this.exportRows.record(attrs.rows, { format: attrs.format });
    this.exportDuration.record(attrs.durationMs, { format: attrs.format });
  }

  recordExportError(attrs: { format: string; errorType: string }): void {
    this.exportErrors.add(1, { format: attrs.format, error_type: attrs.errorType });
  }
}
