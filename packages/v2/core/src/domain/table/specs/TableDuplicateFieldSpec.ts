import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { Field } from '../fields/Field';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Specification for duplicating a field in a table.
 *
 * This is a dedicated spec (not reusing TableAddFieldSpec) because:
 * 1. It carries both the source field and the new field
 * 2. It includes the includeRecordValues flag for SQL-level value copying
 * 3. Repository visitors can generate optimized SQL (INSERT SELECT / UPDATE SET)
 */
export class TableDuplicateFieldSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly sourceFieldValue: Field,
    private readonly newFieldValue: Field,
    private readonly includeRecordValuesFlag: boolean
  ) {
    super();
  }

  static create(
    sourceField: Field,
    newField: Field,
    includeRecordValues: boolean
  ): TableDuplicateFieldSpec {
    return new TableDuplicateFieldSpec(sourceField, newField, includeRecordValues);
  }

  sourceField(): Field {
    return this.sourceFieldValue;
  }

  newField(): Field {
    return this.newFieldValue;
  }

  includeRecordValues(): boolean {
    return this.includeRecordValuesFlag;
  }

  mutate(t: Table): Result<Table, DomainError> {
    // The actual mutation is adding the new field to the table
    // Value copying is handled separately by the repository via FieldValueDuplicateVisitor
    return t.addField(this.newFieldValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableDuplicateField(this).map(() => undefined);
  }
}
