/**
 * Status of a schema check result.
 */
export type SchemaCheckStatus = 'success' | 'error' | 'warn' | 'pending' | 'running';

/**
 * Result of checking a single schema rule.
 */
export interface SchemaCheckResult {
  /** Unique identifier for this check (fieldId:ruleId) */
  id: string;

  /** Field ID being checked */
  fieldId: string;

  /** Field name for display */
  fieldName: string;

  /** Rule ID being checked */
  ruleId: string;

  /** Human-readable rule description */
  ruleDescription: string;

  /** Status of the check */
  status: SchemaCheckStatus;

  /** Success/error/warning message */
  message?: string;

  /** Detailed information about missing/extra schema objects */
  details?: {
    missing?: ReadonlyArray<string>;
    extra?: ReadonlyArray<string>;
  };

  /** Whether this rule is required or optional */
  required: boolean;

  /** Timestamp when check was performed */
  timestamp: number;

  /** IDs of rules this rule depends on (for parent-child relationship display) */
  dependencies: ReadonlyArray<string>;

  /** Nesting depth for display (0 = root, 1+ = nested under parent) */
  depth: number;
}

/**
 * Creates a pending check result.
 */
export const pendingResult = (
  fieldId: string,
  fieldName: string,
  ruleId: string,
  ruleDescription: string,
  required: boolean,
  dependencies: ReadonlyArray<string> = [],
  depth: number = 0
): SchemaCheckResult => ({
  id: `${fieldId}:${ruleId}`,
  fieldId,
  fieldName,
  ruleId,
  ruleDescription,
  status: 'pending',
  required,
  timestamp: Date.now(),
  dependencies,
  depth,
});

/**
 * Creates a running check result.
 */
export const runningResult = (pending: SchemaCheckResult): SchemaCheckResult => ({
  ...pending,
  status: 'running',
  timestamp: Date.now(),
});

/**
 * Creates a success check result.
 */
export const successResult = (pending: SchemaCheckResult): SchemaCheckResult => ({
  ...pending,
  status: 'success',
  message: 'Schema is valid',
  timestamp: Date.now(),
});

/**
 * Creates an error check result.
 */
export const errorResult = (
  pending: SchemaCheckResult,
  message: string,
  details?: { missing?: ReadonlyArray<string>; extra?: ReadonlyArray<string> }
): SchemaCheckResult => ({
  ...pending,
  status: 'error',
  message,
  details,
  timestamp: Date.now(),
});

/**
 * Creates a warning check result (for optional rules that are not satisfied).
 */
export const warnResult = (
  pending: SchemaCheckResult,
  message: string,
  details?: { missing?: ReadonlyArray<string>; extra?: ReadonlyArray<string> }
): SchemaCheckResult => ({
  ...pending,
  status: 'warn',
  message,
  details,
  timestamp: Date.now(),
});

/**
 * Get human-readable description for a rule ID.
 */
export const getRuleDescription = (ruleId: string): string => {
  const [type] = ruleId.split(':');
  switch (type) {
    case 'column':
      return 'Physical column';
    case 'not_null':
      return 'NOT NULL constraint';
    case 'column_unique':
      return 'UNIQUE constraint';
    case 'fk_column':
      return 'Foreign key column';
    case 'index':
      return 'Index';
    case 'unique_index':
      return 'Unique index';
    case 'fk':
      return 'Foreign key constraint';
    case 'junction_table':
      return 'Junction table';
    case 'junction_unique':
      return 'Junction table unique constraint';
    case 'junction_index':
      return 'Junction table index';
    case 'junction_fk':
      return 'Junction table foreign key';
    case 'reference':
      return 'Reference records';
    case 'generated_column':
      return 'Generated column';
    case 'link_value_column':
      return 'Link value column';
    case 'order_column':
      return 'Order column';
    case 'field_meta':
      return 'Field metadata';
    case 'symmetric_field':
      return 'Symmetric field relationship';
    default:
      return ruleId;
  }
};
