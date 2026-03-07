export interface IDomainContextConfig {
  selectFieldOptions?: {
    maxChoicesPerField?: number;
  };
  tableFields?: {
    maxFieldsPerTable?: number;
  };
}

export interface IDomainContext {
  t?: (key: string, options?: Record<string, unknown>) => string;
  config?: IDomainContextConfig;
}
