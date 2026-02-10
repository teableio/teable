import { z } from 'zod';

/**
 * Field key type constants
 * Determines how field identifiers are interpreted in API requests/responses
 */
export const FieldKeyType = {
  /** Use field IDs (default) - most stable, unaffected by renames */
  Id: 'id',
  /** Use field names - human readable, but breaks on rename */
  Name: 'name',
  /** Use database field names - for DB tools and ETL scenarios */
  DbFieldName: 'dbFieldName',
} as const;

export type FieldKeyType = (typeof FieldKeyType)[keyof typeof FieldKeyType];

/**
 * Zod schema for field key type
 * Defaults to 'id' for maximum stability
 */
export const fieldKeyTypeSchema = z
  .enum(['id', 'name', 'dbFieldName'])
  .optional()
  .default(FieldKeyType.Id);

export type IFieldKeyType = z.infer<typeof fieldKeyTypeSchema>;
