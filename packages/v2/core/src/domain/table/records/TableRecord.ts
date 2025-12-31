import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { Entity } from '../../shared/Entity';
import type { TableId } from '../TableId';
import type { RecordId } from './RecordId';
import { RecordConditionSpecBuilder } from './specs/RecordConditionSpecBuilder';
import { TableRecordFields, type TableRecordFieldValue } from './TableRecordFields';

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

  static specs(): RecordConditionSpecBuilder {
    return RecordConditionSpecBuilder.create();
  }
}
