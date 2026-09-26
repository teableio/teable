import type {
  ITableQueryObservability,
  TableQueryObservabilityEvent,
  TableQuerySearchValidationEvent,
} from '../TableQueryObservability';

export class NoopTableQueryObservability implements ITableQueryObservability {
  recordRequest(_event: TableQueryObservabilityEvent): void {
    // intentionally empty
  }

  recordError(_event: TableQueryObservabilityEvent): void {
    // intentionally empty
  }

  recordSearchFallback(_event: TableQueryObservabilityEvent): void {
    // intentionally empty
  }

  recordSearchValidation(_event: TableQuerySearchValidationEvent): void {
    // intentionally empty
  }
}
