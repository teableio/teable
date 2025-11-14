import type { Attributes } from '@opentelemetry/api';

export type IAttributes = Attributes;

export interface IMetricOptions {
  description?: string;
  unit?: string;
}

export abstract class IMetricsProvider {
  abstract name: string;
  abstract options?: IMetricOptions;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_name: string, _options?: IMetricOptions) {}
  abstract count(value: number, attributes?: IAttributes): void;
  abstract gauge(value: number, attributes?: IAttributes): void;
  abstract distribution(value: number, attributes?: IAttributes): void;
}
