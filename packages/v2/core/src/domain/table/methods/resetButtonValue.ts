import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import { ButtonField } from '../fields/types/ButtonField';
import type { RecordId } from '../records/RecordId';
import type { RecordUpdateResult } from '../records/RecordUpdateResult';
import type { Table } from '../Table';

export type ResetButtonValueParams = {
  readonly recordId: RecordId;
  readonly fieldId: FieldId;
};

/**
 * Builds the aggregate-authorized Button reset mutation.
 *
 * Reset eligibility belongs to the Button Field child owned by Table. The
 * returned mutation remains an internal Button value spec and cannot be
 * constructed through generic Record update input.
 */
export function resetButtonValue(
  this: Table,
  params: ResetButtonValueParams
): Result<RecordUpdateResult, DomainError> {
  const field = this.getField((candidate) => candidate.id().equals(params.fieldId));
  if (field.isErr()) return err(field.error);
  if (!(field.value instanceof ButtonField)) {
    return err(
      domainError.validation({
        code: 'button.field_type_invalid',
        message: 'Field is not a Button field',
        details: { fieldId: params.fieldId.toString() },
      })
    );
  }
  if (field.value.resetCount()?.toBoolean() !== true) {
    return err(
      domainError.validation({
        code: 'button.reset_not_supported',
        message: 'Button field does not support reset',
        details: {
          fieldId: params.fieldId.toString(),
          i18nKey: 'httpErrors.field.button.notSupportReset',
        },
      })
    );
  }
  return this.setButtonValue({ ...params, value: null });
}
