import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableRecord } from '../../TableRecord';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

export class SetUserValueByIdentifierSpec extends MutateOnlySpec<
  TableRecord,
  ICellValueSpecVisitor
> {
  private constructor(
    readonly fieldId: FieldId,
    readonly identifiers: ReadonlyArray<string>,
    readonly isMultiple: boolean
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    identifiers: ReadonlyArray<string>,
    isMultiple: boolean
  ): SetUserValueByIdentifierSpec {
    return new SetUserValueByIdentifierSpec(fieldId, identifiers, isMultiple);
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return ok(record);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetUserValueByIdentifier(this);
  }
}
