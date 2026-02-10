import type { ICellValueSpec } from './specs/values/ICellValueSpecVisitor';
import type { TableRecord } from './TableRecord';

/**
 * Field key mapping: Map<fieldId, originalKey>
 * Used to mirror the input format in the response.
 */
export type FieldKeyMapping = Map<string, string>;

/**
 * Result of a record creation operation.
 *
 * Contains both the created record (for in-memory use) and the mutation spec
 * (for persistence layer to generate SQL statements and resolve link titles).
 *
 * This separation allows:
 * 1. Domain layer to work with the created record
 * 2. Handler layer to resolve link titles via LinkTitleResolverService
 * 3. Repository adapters to use the spec for generating optimized SQL
 * 4. Response formatters to use fieldKeyMapping for mirroring input format
 */
export class RecordCreateResult {
  private constructor(
    readonly record: TableRecord,
    readonly mutateSpec: ICellValueSpec | null,
    readonly fieldKeyMapping: FieldKeyMapping
  ) {}

  static create(
    record: TableRecord,
    mutateSpec: ICellValueSpec | null,
    fieldKeyMapping: FieldKeyMapping = new Map()
  ): RecordCreateResult {
    return new RecordCreateResult(record, mutateSpec, fieldKeyMapping);
  }
}
