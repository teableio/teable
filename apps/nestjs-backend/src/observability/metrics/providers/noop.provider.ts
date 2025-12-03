import type { IMetricsProvider } from './metrics-provider.interface';

export class NoopMetricsProvider implements IMetricsProvider {
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  count(_value: number): void {
    // no-op
  }

  gauge(_value: number): void {
    // no-op
  }

  distribution(_value: number): void {
    // no-op
  }
}
