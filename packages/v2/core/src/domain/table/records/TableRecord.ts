import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { Entity } from '../../shared/Entity';
import type { SpecBuilderMode } from '../../shared/specification/SpecBuilder';
import { FieldId } from '../fields/FieldId';
import {
  normalizeCellDisplayValue,
  normalizeCellDisplayValues,
} from '../fields/visitors/normalizeCellDisplayValue';
import type { Table } from '../Table';
import type { TableId } from '../TableId';
import { RecordId } from './RecordId';
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

  static fromRawFieldValues(params: {
    id: string;
    tableId: TableId;
    fields: Record<string, unknown>;
  }): Result<TableRecord, DomainError> {
    return RecordId.create(params.id).andThen((recordId) => {
      const fieldValues: TableRecordFieldValue[] = [];

      for (const [fieldIdText, rawValue] of Object.entries(params.fields)) {
        const fieldIdResult = FieldId.create(fieldIdText);
        if (fieldIdResult.isErr()) {
          continue;
        }

        const cellValueResult = TableRecordCellValue.create(rawValue);
        if (cellValueResult.isErr()) {
          return err(cellValueResult.error);
        }

        fieldValues.push({
          fieldId: fieldIdResult.value,
          value: cellValueResult.value,
        });
      }

      return TableRecord.create({
        id: recordId,
        tableId: params.tableId,
        fieldValues,
      });
    });
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
   * Resolve the record display name from the table's primary field value.
   *
   * The table parameter is required because the record only stores field values;
   * the owning table defines which field is primary and whether its cell value is
   * single or multi-valued.
   */
  displayName(table: Table): Result<string | null, DomainError> {
    if (!this.tableIdValue.equals(table.id())) {
      return err(
        domainError.invariant({
          code: 'record.table_mismatch',
          message: 'Cannot resolve display name with a different table',
          details: {
            recordTableId: this.tableIdValue.toString(),
            tableId: table.id().toString(),
          },
        })
      );
    }

    return table.primaryField().andThen((field) =>
      field.isMultipleCellValue().map((multiplicity) => {
        const primaryValue = this.fieldsValue.get(field.id())?.toValue();

        if (multiplicity.isMultiple()) {
          const displayValues = normalizeCellDisplayValues(primaryValue);
          return displayValues.length > 0 ? displayValues.join(', ') : null;
        }

        return normalizeCellDisplayValue(primaryValue);
      })
    );
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
