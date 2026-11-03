import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { AndSpec } from '../../shared/specification/AndSpec';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import type { RecordId } from './RecordId';
import type { ClearFieldValueSpec } from './specs/values/ClearFieldValueSpec';
import type { ICellValueSpec, ICellValueSpecVisitor } from './specs/values/ICellValueSpecVisitor';
import type { SetAttachmentValueSpec } from './specs/values/SetAttachmentValueSpec';
import type { SetButtonValueSpec } from './specs/values/SetButtonValueSpec';
import type { SetCheckboxValueSpec } from './specs/values/SetCheckboxValueSpec';
import type { SetDateValueSpec } from './specs/values/SetDateValueSpec';
import type { SetLinkValueByTitleSpec } from './specs/values/SetLinkValueByTitleSpec';
import type { SetLinkValueSpec } from './specs/values/SetLinkValueSpec';
import type { SetLongTextValueSpec } from './specs/values/SetLongTextValueSpec';
import type { SetMultipleSelectValueSpec } from './specs/values/SetMultipleSelectValueSpec';
import type { SetNumberValueSpec } from './specs/values/SetNumberValueSpec';
import type { SetRatingValueSpec } from './specs/values/SetRatingValueSpec';
import type { SetRowOrderValueSpec } from './specs/values/SetRowOrderValueSpec';
import type { SetSingleLineTextValueSpec } from './specs/values/SetSingleLineTextValueSpec';
import type { SetSingleSelectValueSpec } from './specs/values/SetSingleSelectValueSpec';
import type { SetUserValueByIdentifierSpec } from './specs/values/SetUserValueByIdentifierSpec';
import type { SetUserValueSpec } from './specs/values/SetUserValueSpec';
import { TableRecord } from './TableRecord';
import { TableRecordCellValue, type TableRecordFieldValue } from './TableRecordFields';

type MaterializedCellSpec = {
  readonly fieldId: FieldId;
  readonly value: { toValue(): unknown };
};

class RecordSpecCellValueCollector implements ICellValueSpecVisitor {
  private readonly fieldValues: TableRecordFieldValue[] = [];
  private readonly indexByFieldId = new Map<string, number>();

  collect(
    spec: ICellValueSpec,
    baseFields?: ReadonlyArray<TableRecordFieldValue>
  ): Result<ReadonlyArray<TableRecordFieldValue>, DomainError> {
    return spec.accept(this).map(() => {
      if (!baseFields?.length) return this.fieldValues;
      // Index only the assigned cells, not every existing cell in a wide record.
      const merged = baseFields.map((entry) => {
        const key = entry.fieldId.toString();
        const index = this.indexByFieldId.get(key);
        if (index === undefined) return entry;
        this.indexByFieldId.delete(key);
        return this.fieldValues[index]!;
      });
      for (const entry of this.fieldValues) {
        if (this.indexByFieldId.has(entry.fieldId.toString())) merged.push(entry);
      }
      return merged;
    });
  }

  private setCell(fieldId: FieldId, rawValue: unknown): Result<void, DomainError> {
    return TableRecordCellValue.create(rawValue).map((value) => {
      const fieldValue = { fieldId, value };
      const key = fieldId.toString();
      const existingIndex = this.indexByFieldId.get(key);
      if (existingIndex === undefined) {
        this.indexByFieldId.set(key, this.fieldValues.length);
        this.fieldValues.push(fieldValue);
      } else {
        this.fieldValues[existingIndex] = fieldValue;
      }
    });
  }

  private setKnownCell(spec: MaterializedCellSpec): Result<void, DomainError> {
    return this.setCell(spec.fieldId, spec.value.toValue());
  }

  visitSetSingleLineTextValue(spec: SetSingleLineTextValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetLongTextValue(spec: SetLongTextValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetNumberValue(spec: SetNumberValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetRatingValue(spec: SetRatingValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetSingleSelectValue(spec: SetSingleSelectValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetMultipleSelectValue(spec: SetMultipleSelectValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetCheckboxValue(spec: SetCheckboxValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetDateValue(spec: SetDateValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetAttachmentValue(spec: SetAttachmentValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetButtonValue(spec: SetButtonValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetLinkValue(spec: SetLinkValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitSetUserValue(spec: SetUserValueSpec): Result<void, DomainError> {
    return this.setKnownCell(spec);
  }

  visitClearFieldValue(spec: ClearFieldValueSpec): Result<void, DomainError> {
    return this.setCell(spec.field.id(), null);
  }

  visitSetLinkValueByTitle(_spec: SetLinkValueByTitleSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetUserValueByIdentifier(_spec: SetUserValueByIdentifierSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetRowOrderValue(_spec: SetRowOrderValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ICellValueSpec is built from value specs joined by AndSpec. Reject any new composite
  // instead of silently giving it different in-memory semantics.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(spec: ISpecification<any, any>): Result<void, DomainError> {
    if (spec instanceof AndSpec) return ok(undefined);
    return err(
      domainError.invariant({
        code: 'record.materialize.unsupported_mutation_spec',
        message: 'Record materialization can only apply cell value specs joined by AND',
      })
    );
  }
}

/**
 * Applies a cell-value spec tree to one immutable record in a single pass.
 *
 * `baseFields` carries an existing record's cells for reapplication after deferred
 * user/link resolution; omitted for create and update, where only the spec cells belong
 * in the in-memory record.
 */
export const materializeRecordSpec = (params: {
  id: RecordId;
  tableId: TableId;
  spec: ICellValueSpec;
  baseFields?: ReadonlyArray<TableRecordFieldValue>;
}): Result<TableRecord, DomainError> => {
  const collector = new RecordSpecCellValueCollector();
  return collector.collect(params.spec, params.baseFields).andThen((fieldValues) =>
    TableRecord.create({
      id: params.id,
      tableId: params.tableId,
      fieldValues,
    })
  );
};
