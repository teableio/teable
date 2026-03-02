import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

@Injectable()
export class ImportMetricsService {
  private readonly meter = metrics.getMeter('teable-observability');

  private readonly importTotal = this.meter.createCounter('data.import.total', {
    description: 'Total number of import tasks queued',
  });
  private readonly importDuration = this.meter.createHistogram('data.import.duration', {
    description: 'Import task processing duration in milliseconds',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [
        1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 180000, 300000,
      ],
    },
  });
  private readonly importErrors = this.meter.createCounter('data.import.errors', {
    description: 'Total number of import errors',
  });

  recordImportQueued(attrs: { fileType: string; operationType: string }): void {
    this.importTotal.add(1, {
      file_type: attrs.fileType,
      operation_type: attrs.operationType,
    });
  }

  recordImportComplete(attrs: {
    fileType: string;
    operationType: string;
    durationMs: number;
  }): void {
    this.importDuration.record(attrs.durationMs, {
      file_type: attrs.fileType,
      operation_type: attrs.operationType,
    });
  }

  recordImportError(attrs: { fileType: string; operationType: string; errorType: string }): void {
    this.importErrors.add(1, {
      file_type: attrs.fileType,
      operation_type: attrs.operationType,
      error_type: attrs.errorType,
    });
  }
}
