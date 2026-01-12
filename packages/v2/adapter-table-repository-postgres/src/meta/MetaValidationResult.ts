/**
 * Category of a meta validation issue.
 *
 * - `schema`: Issues with field configuration values (e.g., invalid rating max)
 * - `reference`: Issues with references to other entities (e.g., missing foreign table)
 */
export type MetaValidationCategory = 'schema' | 'reference';

/**
 * Severity level of a meta validation issue.
 */
export type MetaValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Details about a meta validation issue.
 */
export interface MetaValidationIssueDetails {
  /** Path to the problematic property (e.g., 'options.foreignTableId') */
  path?: string;
  /** Expected value or type */
  expected?: string;
  /** Actual value received */
  received?: string;
  /** Related table ID (for reference issues) */
  relatedTableId?: string;
  /** Related field ID (for reference issues) */
  relatedFieldId?: string;
}

/**
 * A single meta validation issue found during field validation.
 */
export interface MetaValidationIssue {
  /** ID of the field with the issue */
  fieldId: string;
  /** Name of the field for display */
  fieldName: string;
  /** Type of the field (e.g., 'link', 'lookup') */
  fieldType: string;
  /** Category of the issue */
  category: MetaValidationCategory;
  /** Severity level */
  severity: MetaValidationSeverity;
  /** Human-readable message describing the issue */
  message: string;
  /** Additional details about the issue */
  details?: MetaValidationIssueDetails;
}

/**
 * Summary result of meta validation for a table.
 */
export interface MetaValidationResult {
  /** ID of the table being validated */
  tableId: string;
  /** Name of the table for display */
  tableName: string;
  /** All issues found during validation */
  issues: MetaValidationIssue[];
  /** Number of fields checked */
  checkedFieldCount: number;
  /** Timestamp when validation was performed */
  timestamp: number;
}

/**
 * Creates a meta validation issue for a field.
 */
export const createIssue = (params: {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  category: MetaValidationCategory;
  severity: MetaValidationSeverity;
  message: string;
  details?: MetaValidationIssueDetails;
}): MetaValidationIssue => ({
  fieldId: params.fieldId,
  fieldName: params.fieldName,
  fieldType: params.fieldType,
  category: params.category,
  severity: params.severity,
  message: params.message,
  details: params.details,
});

/**
 * Creates a reference error issue (e.g., missing foreign table).
 */
export const referenceError = (params: {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  message: string;
  relatedTableId?: string;
  relatedFieldId?: string;
}): MetaValidationIssue =>
  createIssue({
    fieldId: params.fieldId,
    fieldName: params.fieldName,
    fieldType: params.fieldType,
    category: 'reference',
    severity: 'error',
    message: params.message,
    details: {
      ...(params.relatedTableId ? { relatedTableId: params.relatedTableId } : {}),
      ...(params.relatedFieldId ? { relatedFieldId: params.relatedFieldId } : {}),
    },
  });

/**
 * Creates a schema error issue (e.g., invalid field configuration).
 */
export const schemaError = (params: {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  message: string;
  path?: string;
  expected?: string;
  received?: string;
}): MetaValidationIssue =>
  createIssue({
    fieldId: params.fieldId,
    fieldName: params.fieldName,
    fieldType: params.fieldType,
    category: 'schema',
    severity: 'error',
    message: params.message,
    details: {
      ...(params.path ? { path: params.path } : {}),
      ...(params.expected ? { expected: params.expected } : {}),
      ...(params.received ? { received: params.received } : {}),
    },
  });

/**
 * Creates a warning issue.
 */
export const warningIssue = (params: {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  category: MetaValidationCategory;
  message: string;
  details?: MetaValidationIssueDetails;
}): MetaValidationIssue =>
  createIssue({
    ...params,
    severity: 'warning',
  });

/**
 * Creates an info issue.
 */
export const infoIssue = (params: {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  category: MetaValidationCategory;
  message: string;
  details?: MetaValidationIssueDetails;
}): MetaValidationIssue =>
  createIssue({
    ...params,
    severity: 'info',
  });

/**
 * Creates a reference success info (e.g., foreign table found).
 */
export const referenceSuccess = (params: {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  message: string;
  relatedTableId?: string;
  relatedFieldId?: string;
}): MetaValidationIssue =>
  createIssue({
    fieldId: params.fieldId,
    fieldName: params.fieldName,
    fieldType: params.fieldType,
    category: 'reference',
    severity: 'info',
    message: params.message,
    details: {
      ...(params.relatedTableId ? { relatedTableId: params.relatedTableId } : {}),
      ...(params.relatedFieldId ? { relatedFieldId: params.relatedFieldId } : {}),
    },
  });

/**
 * Creates a schema success info.
 */
export const schemaSuccess = (params: {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  message: string;
  path?: string;
}): MetaValidationIssue =>
  createIssue({
    fieldId: params.fieldId,
    fieldName: params.fieldName,
    fieldType: params.fieldType,
    category: 'schema',
    severity: 'info',
    message: params.message,
    details: params.path ? { path: params.path } : undefined,
  });
