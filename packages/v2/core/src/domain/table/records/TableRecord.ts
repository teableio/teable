import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { Entity } from '../../shared/Entity';
import type { SpecBuilderMode } from '../../shared/specification/SpecBuilder';
import type { FieldId } from '../fields/FieldId';
import type { TableId } from '../TableId';
import type { RecordId } from './RecordId';
import { RecordConditionSpecBuilder } from './specs/RecordConditionSpecBuilder';
import {
  TableRecordCellValue,
  TableRecordFields,
  type TableRecordFieldValue,
} from './TableRecordFields';
import type { CellValue } from './values/CellValue';

export class TableRecord extends Entity<RecordId> {
  private constructor(
    id: RecordId,
    private readonly tableIdValue: TableId,
    private readonly fieldsValue: TableRecordFields
  ) {
    super(id);
  }

  static create(params: {
    id: RecordId;
    tableId: TableId;
    fieldValues: ReadonlyArray<TableRecordFieldValue>;
  }): Result<TableRecord, DomainError> {
    return TableRecordFields.create(params.fieldValues).map(
      (fields) => new TableRecord(params.id, params.tableId, fields)
    );
  }

  tableId(): TableId {
    return this.tableIdValue;
  }

  fields(): TableRecordFields {
    return this.fieldsValue;
  }

  static specs(mode: SpecBuilderMode = 'and'): RecordConditionSpecBuilder {
    return RecordConditionSpecBuilder.create(mode);
  }

  /**
   * Set a field value, returning a new TableRecord instance.
   * This is used by SetValueSpec.mutate() to update the record in memory.
   */
  setFieldValue<T>(fieldId: FieldId, value: CellValue<T>): Result<TableRecord, DomainError> {
    // Convert CellValue<T> to TableRecordCellValue
    return TableRecordCellValue.create(value.toValue()).andThen((cellValue) =>
      this.fieldsValue
        .set(fieldId, cellValue)
        .map((newFields) => new TableRecord(this.id(), this.tableIdValue, newFields))
    );
  }
}
