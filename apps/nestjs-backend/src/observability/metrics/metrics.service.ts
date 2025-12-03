import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IMetricOptions, IMetricsProvider } from './providers/metrics-provider.interface';
import { NoopMetricsProvider } from './providers/noop.provider';
import { OpenTelemetryMetricsProvider } from './providers/open-telemetry.provider';
import { SentryMetricsProvider } from './providers/sentry.provider';

export enum MetricsProviderType {
  SENTRY = 'sentry',
  OPENTELEMETRY = 'opentelemetry',
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private provider: MetricsProviderType;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.configService.get('METRICS_PROVIDER') as MetricsProviderType;
    this.logger.log(`🔍 Metrics provider: ${this.provider}`);
  }

  create(metricsName: string, options?: IMetricOptions): IMetricsProvider {
    switch (this.provider) {
      case MetricsProviderType.SENTRY:
        return new SentryMetricsProvider(metricsName, options);
      case MetricsProviderType.OPENTELEMETRY:
        return new OpenTelemetryMetricsProvider(metricsName, options);
      default:
        return new NoopMetricsProvider(metricsName);
    }
  }
}
