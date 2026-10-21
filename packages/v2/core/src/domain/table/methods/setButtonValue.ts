import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { FieldId } from '../fields/FieldId';
import { ButtonField } from '../fields/types/ButtonField';
import type { RecordId } from '../records/RecordId';
import { RecordUpdateResult } from '../records/RecordUpdateResult';
import {
  type ButtonCellValue,
  SetButtonValueSpec,
} from '../records/specs/values/SetButtonValueSpec';
import { TableRecord } from '../records/TableRecord';
import { CellValue } from '../records/values/CellValue';
import type { Table } from '../Table';

export type SetButtonValueParams = {
  readonly recordId: RecordId;
  readonly fieldId: FieldId;
  readonly value: ButtonCellValue | null;
};

/**
 * Builds the internal Button value mutation used by undo/redo replay.
 *
 * The public record update path must continue to ignore Button values. Keeping
 * this factory on Table makes the aggregate the only place that can authorize
 * the internal persistence spec.
 */
export function setButtonValue(
  this: Table,
  params: SetButtonValueParams
): Result<RecordUpdateResult, DomainError> {
  return safeTry<RecordUpdateResult, DomainError>(
    function* (this: Table) {
      const field = yield* this.getField((candidate) => candidate.id().equals(params.fieldId));
      if (!(field instanceof ButtonField)) {
        return err(
          domainError.validation({
            code: 'button.field_type_invalid',
            message: 'Field is not a Button field',
            details: { fieldId: params.fieldId.toString() },
          })
        );
      }

      const record = yield* TableRecord.create({
        id: params.recordId,
        tableId: this.id(),
        fieldValues: [],
      });
      const spec = new SetButtonValueSpec(
        params.fieldId,
        CellValue.fromValidated<ButtonCellValue>(params.value)
      );
      const updatedRecord = yield* spec.mutate(record);
      return ok(
        RecordUpdateResult.create(
          updatedRecord,
          spec,
          new Map([[params.fieldId.toString(), params.fieldId.toString()]])
        )
      );
    }.bind(this)
  );
}
