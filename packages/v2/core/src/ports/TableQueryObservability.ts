import type {
  SearchTraceAttributeInput,
  TableQueryTraceAttributeInput,
} from './TableQueryTraceAttributes';

export type TableQueryObservabilityEvent = TableQueryTraceAttributeInput &
  SearchTraceAttributeInput & {
    readonly durationMs?: number;
  };

export type TableQuerySearchValidationEvent = TableQueryObservabilityEvent & {
  readonly validationStatus?: string;
  readonly costDeltaPct?: number;
};

export interface ITableQueryObservability {
  recordRequest(event: TableQueryObservabilityEvent): void;
  recordError(event: TableQueryObservabilityEvent): void;
  recordSearchFallback(event: TableQueryObservabilityEvent): void;
  recordSearchValidation(event: TableQuerySearchValidationEvent): void;
}
