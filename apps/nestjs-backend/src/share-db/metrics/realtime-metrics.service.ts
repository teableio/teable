import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

@Injectable()
export class RealtimeMetricsService {
  private readonly meter = metrics.getMeter('teable-observability');

  private readonly connectionsActive = this.meter.createUpDownCounter(
    'realtime.connections.active',
    { description: 'Number of currently active WebSocket connections' }
  );
  private readonly connectionsTotal = this.meter.createCounter('realtime.connections.total', {
    description: 'Total number of WebSocket connections established',
  });
  private readonly disconnectsTotal = this.meter.createCounter('realtime.disconnects.total', {
    description: 'Total number of WebSocket disconnections',
  });
  private readonly operationsTotal = this.meter.createCounter('realtime.operations.total', {
    description: 'Total number of ShareDB operations submitted',
  });
  private readonly operationDuration = this.meter.createHistogram('realtime.operations.duration', {
    description: 'ShareDB operation duration in milliseconds',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    },
  });
  private readonly operationsErrors = this.meter.createCounter('realtime.operations.errors', {
    description: 'Total number of ShareDB operation errors',
  });
  private readonly publishTotal = this.meter.createCounter('realtime.publish.total', {
    description: 'Total number of operations published via PubSub',
  });
  private readonly connectionErrors = this.meter.createCounter('realtime.connections.errors', {
    description: 'Total number of WebSocket connection errors',
  });

  recordConnectionOpen(): void {
    this.connectionsActive.add(1);
    this.connectionsTotal.add(1);
  }

  recordConnectionClose(): void {
    this.connectionsActive.add(-1);
    this.disconnectsTotal.add(1);
  }

  recordConnectionError(): void {
    this.connectionErrors.add(1);
  }

  recordOperationSubmit(durationMs?: number): void {
    this.operationsTotal.add(1);
    if (durationMs != null) {
      this.operationDuration.record(durationMs);
    }
  }

  recordOperationError(errorType: string): void {
    this.operationsErrors.add(1, { error_type: errorType });
  }

  recordOpsPublished(count: number): void {
    this.publishTotal.add(count);
  }
}
