import { FieldKeyType } from '@teable/core';
import type { IDeleteFieldsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { ICreateFieldsPayload } from './create-fields.operation';

export type IDeleteFieldsPayload = ICreateFieldsPayload;
export class DeleteFieldsOperation {
  constructor(
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService
  ) {}

  async event2Operation(payload: IDeleteFieldsPayload): Promise<IDeleteFieldsOperation> {
    return {
      name: OperationName.DeleteFields,
      params: {
        tableId: payload.tableId,
      },
      result: {
        fields: payload.fields,
        records: payload.records,
      },
    };
  }

  async undo(operation: IDeleteFieldsOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { fields, records } = result;

    await this.fieldOpenApiService.createFields(tableId, fields);

    if (records) {
      await this.recordOpenApiService.updateRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        records,
      });
    }
    return operation;
  }

  async redo(operation: IDeleteFieldsOperation) {
    const { params, result } = operation;
    const { tableId } = params;
    const { fields } = result;

    await this.fieldOpenApiService.deleteFields(
      tableId,
      fields.map((field) => field.id)
    );

    return operation;
  }
}
