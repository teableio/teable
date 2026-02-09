import type { IDomainEvent } from '../../shared/DomainEvent';
import type { FieldKeyMapping } from './RecordCreateResult';
import type { ICellValueSpec } from './specs/values/ICellValueSpecVisitor';
import type { TableRecord } from './TableRecord';

/**
 * Result of a record update operation.
 *
 * Contains both the mutated record (for in-memory use) and the mutation spec
 * (for persistence layer to generate SQL statements).
 *
 * This separation allows:
 * 1. Domain layer to work with the mutated record
 * 2. Repository adapters to use the spec for generating optimized SQL
 *    (e.g., atomic increments, batch updates)
 * 3. Response formatters to use fieldKeyMapping for mirroring input format
 */
export class RecordUpdateResult {
  private constructor(
    readonly record: TableRecord,
    readonly mutateSpec: ICellValueSpec,
    readonly fieldKeyMapping: FieldKeyMapping,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    record: TableRecord,
    mutateSpec: ICellValueSpec,
    fieldKeyMapping: FieldKeyMapping = new Map(),
    events: ReadonlyArray<IDomainEvent> = []
  ): RecordUpdateResult {
    return new RecordUpdateResult(record, mutateSpec, fieldKeyMapping, [...events]);
  }
}
