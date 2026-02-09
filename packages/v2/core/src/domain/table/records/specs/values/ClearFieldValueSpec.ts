import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { Field } from '../../../fields/Field';
import type { TableRecord } from '../../TableRecord';
import { CellValue } from '../../values/CellValue';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * Specification for clearing a field value (setting to null).
 *
 * Unlike typed SetValueSpecs, this spec carries the full Field reference
 * so the repository can identify the field type and optimize SQL accordingly
 * (e.g. generating `SET col = NULL` instead of per-row VALUES).
 */
export class ClearFieldValueSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  constructor(readonly field: Field) {
    super();
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return record.setFieldValue(this.field.id(), CellValue.null());
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitClearFieldValue(this);
  }

  static create(field: Field): ClearFieldValueSpec {
    return new ClearFieldValueSpec(field);
  }
}
