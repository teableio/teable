import { FieldKeyType } from '@teable/core';
import type { IColumnMeta, IFieldVo } from '@teable/core';
import type { ICreateFieldsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import { createFieldInstanceByVo } from '../../field/model/factory';
import type { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';

export interface ICreateFieldsPayload {
  windowId: string;
  tableId: string;
  userId: string;
  fields: IFieldVo[];
  records: {
    id: string;
    fields: Record<string, unknown>;
  }[];
  columnsMeta: IColumnMeta[];
}

export class CreateFieldsOperation {
  constructor(
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService
  ) {}

  async event2Operation(payload: ICreateFieldsPayload): Promise<ICreateFieldsOperation> {
    return {
      name: OperationName.CreateFields,
      params: {
        tableId: payload.tableId,
      },
      result: {
        fields: payload.fields,
        records: payload.records,
        columnsMeta: payload.columnsMeta,
      },
    };
  }

  async undo(operation: ICreateFieldsOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { fields } = result;

    await this.fieldOpenApiService.deleteFields(
      tableId,
      fields.map((field) => field.id)
    );

    return operation;
  }

  async redo(operation: ICreateFieldsOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { fields, records: recordFields, columnsMeta } = result;

    await this.fieldOpenApiService.createFields(
      tableId,
      fields.map(createFieldInstanceByVo),
      columnsMeta
    );

    if (recordFields) {
      await this.recordOpenApiService.updateRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        records: recordFields,
      });
    }

    return operation;
  }
}
