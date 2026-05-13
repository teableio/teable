import type { TableDataSafetyLimitConfig } from './TableDataSafetyLimits';

export interface IDomainContextConfig {
  tableLimits?: TableDataSafetyLimitConfig;
  /** @deprecated Use `tableLimits.fieldOptions.maxSelectChoices`. */
  selectFieldOptions?: {
    maxChoicesPerField?: number;
  };
  /** @deprecated Use `tableLimits.tableSchema.maxFieldsPerTable`. */
  tableFields?: {
    maxFieldsPerTable?: number;
  };
}

export interface IDomainContext {
  t?: (key: string, options?: Record<string, unknown>) => string;
  config?: IDomainContextConfig;
}
