import type { Attributes } from '@opentelemetry/api';

export type IAttributes = Attributes;

export interface IMetricOptions {
  description?: string;
  unit?: string;
}

export interface IMetricsProvider {
  name: string;
  options?: IMetricOptions;
  count(value: number, attributes?: IAttributes): void;
  gauge(value: number, attributes?: IAttributes): void;
  distribution(value: number, attributes?: IAttributes): void;
}
