import type {
  ITableQueryObservability,
  TableQueryObservabilityEvent,
  TableQuerySearchValidationEvent,
} from '../TableQueryObservability';

export class NoopTableQueryObservability implements ITableQueryObservability {
  recordRequest(_event: TableQueryObservabilityEvent): void {}

  recordError(_event: TableQueryObservabilityEvent): void {}

  recordSearchFallback(_event: TableQueryObservabilityEvent): void {}

  recordSearchValidation(_event: TableQuerySearchValidationEvent): void {}
}
