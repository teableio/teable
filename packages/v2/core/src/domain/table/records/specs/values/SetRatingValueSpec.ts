import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableRecord } from '../../TableRecord';
import type { CellValue } from '../../values/CellValue';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * Specification for setting a rating field value.
 * The value should be an integer between 1 and the field's max rating.
 */
export class SetRatingValueSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  constructor(
    readonly fieldId: FieldId,
    readonly value: CellValue<number>
  ) {
    super();
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return record.setFieldValue(this.fieldId, this.value);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetRatingValue(this);
  }
}
