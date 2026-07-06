import type { DataPrismaService } from '@teable/db-data-prisma';
import type { IDeleteFieldsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import { restoreFieldRecordValues } from '../../field/restore-field-record-values';
import type { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import type { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { ICreateFieldsPayload } from './create-fields.operation';

export type IDeleteFieldsPayload = ICreateFieldsPayload & { operationId: string };

type IScopedDataPrismaService = DataPrismaService & {
  txClient?: () => DataPrismaService;
};

export class DeleteFieldsOperation {
  constructor(
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly dataDbClientManager: DataDbClientManager
  ) {}

  private async dataPrismaForTable(tableId: string): Promise<DataPrismaService> {
    const dataPrisma = (await this.dataDbClientManager.dataPrismaForTable(tableId, {
      useTransaction: true,
    })) as IScopedDataPrismaService;
    return (dataPrisma.txClient?.() ?? dataPrisma) as DataPrismaService;
  }

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
    const dataPrisma = await this.dataPrismaForTable(tableId);

    const count = await dataPrisma.tableTrash.count({
      where: { id: operationId },
    });

    if (operationId && Number(count) === 0) return operation;

    await this.fieldOpenApiService.createFields(tableId, fields, undefined, {
      restoreViewOrder: true,
    });

    await restoreFieldRecordValues(tableId, records, this.recordOpenApiService);

    if (operationId) {
      await dataPrisma.tableTrash.delete({
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
