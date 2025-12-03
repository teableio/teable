import { Injectable } from '@nestjs/common';
import { metrics, type Counter, type Gauge, type Histogram } from '@opentelemetry/api';
import { IMetricOptions } from './metrics-provider.interface';
import type { IAttributes, IMetricsProvider } from './metrics-provider.interface';

@Injectable()
export class OpenTelemetryMetricsProvider implements IMetricsProvider {
  name: string;
  options?: IMetricOptions;
  private _counter?: Counter;
  private _histogram?: Histogram;
  private _gauge?: Gauge;
  private readonly meter = metrics.getMeter('teable-observability');

  constructor(name: string, options?: IMetricOptions) {
    this.name = name;
    this.options = options;
  }

  private getCounter(name: string): Counter {
    if (!this._counter) {
      this._counter = this.meter.createCounter(name, {
        description: this.options?.description,
        unit: this.options?.unit,
      });
    }
    return this._counter;
  }

  private getHistogram(name: string): Histogram {
    if (!this._histogram) {
      this._histogram = this.meter.createHistogram(name, {
        description: this.options?.description,
        unit: this.options?.unit,
      });
    }
    return this._histogram;
  }

  private getGauge(name: string): Gauge {
    if (!this._gauge) {
      this._gauge = this.meter.createGauge(name, {
        description: this.options?.description,
        unit: this.options?.unit,
      });
    }
    return this._gauge;
  }

  count(value: number, attributes?: IAttributes): void {
    this.getCounter(this.name).add(value, attributes);
  }

  gauge(value: number, attributes?: IAttributes): void {
    this.getGauge(this.name).record(value, attributes);
  }

  distribution(value: number, attributes?: IAttributes): void {
    this.getHistogram(this.name).record(value, attributes);
  }
}
