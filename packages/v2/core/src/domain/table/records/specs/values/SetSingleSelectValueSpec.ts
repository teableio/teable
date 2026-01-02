import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableRecord } from '../../TableRecord';
import type { CellValue } from '../../values/CellValue';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * Specification for setting a single select field value.
 * The value should be a valid option ID from the field's options.
 */
export class SetSingleSelectValueSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  constructor(
    readonly fieldId: FieldId,
    readonly value: CellValue<string>
  ) {
    super();
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return record.setFieldValue(this.fieldId, this.value);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetSingleSelectValue(this);
  }
}
