import type { ICellValueSpec } from './specs/values/ICellValueSpecVisitor';
import type { TableRecord } from './TableRecord';

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
 */
export class RecordCreateResult {
  private constructor(
    readonly record: TableRecord,
    readonly mutateSpec: ICellValueSpec | null
  ) {}

  static create(record: TableRecord, mutateSpec: ICellValueSpec | null): RecordCreateResult {
    return new RecordCreateResult(record, mutateSpec);
  }
}
