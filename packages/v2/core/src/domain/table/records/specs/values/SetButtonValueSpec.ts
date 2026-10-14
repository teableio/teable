import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableRecord } from '../../TableRecord';
import type { CellValue } from '../../values/CellValue';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

export type ButtonCellValue = {
  readonly count: number;
};

/**
 * Button count mutation for record writes and dedicated button commands.
 * Direct writes validate the cell value; click commands additionally validate
 * workflow state and click limits in the owning Table aggregate.
 */
export class SetButtonValueSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  constructor(
    readonly fieldId: FieldId,
    readonly value: CellValue<ButtonCellValue>
  ) {
    super();
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return record.setFieldValue(this.fieldId, this.value);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetButtonValue(this);
  }
}
