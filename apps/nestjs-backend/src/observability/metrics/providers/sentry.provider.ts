import * as Sentry from '@sentry/nestjs';
import type { IAttributes, IMetricOptions, IMetricsProvider } from './metrics-provider.interface';

export class SentryMetricsProvider implements IMetricsProvider {
  name = 'sentry';
  options?: IMetricOptions;

  constructor(name: string, options?: IMetricOptions) {
    this.name = name;
    this.options = options;
  }

  distribution(value: number, attributes?: IAttributes): void {
    Sentry.metrics.distribution(this.name, value, {
      attributes: {
        ...attributes,
        unit: this.options?.unit,
      },
    });
  }
  count(value: number, attributes?: IAttributes): void {
    Sentry.metrics.count(this.name, value, {
      attributes: {
        ...attributes,
        unit: this.options?.unit,
      },
    });
  }
  gauge(value: number, attributes?: IAttributes): void {
    Sentry.metrics.gauge(this.name, value, {
      attributes: {
        ...attributes,
        unit: this.options?.unit,
      },
    });
  }
}
