import { FieldKeyType } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import type { IDeleteFieldsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { ICreateFieldsPayload } from './create-fields.operation';

export type IDeleteFieldsPayload = ICreateFieldsPayload & { operationId: string };
export class DeleteFieldsOperation {
  constructor(
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly prismaService: PrismaService
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
      operationId: payload.operationId,
    };
  }

  async undo(operation: IDeleteFieldsOperation) {
    const { params, result, operationId = '' } = operation;
    const { tableId } = params;
    const { fields, records } = result;

    const count = await this.prismaService.tableTrash.count({
      where: { id: operationId },
    });

    if (operationId && Number(count) === 0) return operation;

    await this.fieldOpenApiService.createFields(tableId, fields);

    if (records) {
      await this.recordOpenApiService.updateRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        records,
      });
    }

    if (operationId) {
      await this.prismaService.tableTrash.delete({
        where: { id: operationId },
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
