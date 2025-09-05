import type { IRecord } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import type { IDeleteRecordsOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import type { IThresholdConfig } from '../../../configs/threshold.config';
import type { RecordOpenApiService } from '../../record/open-api/record-open-api.service';

export interface IDeleteRecordsPayload {
  operationId: string;
  windowId: string;
  tableId: string;
  userId: string;
  records: (IRecord & { order: Record<string, number> })[];
}

export class DeleteRecordsOperation {
  constructor(
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly prismaService: PrismaService,
    private readonly thresholdConfig: IThresholdConfig
  ) {}

  async event2Operation(payload: IDeleteRecordsPayload): Promise<IDeleteRecordsOperation> {
    return {
      name: OperationName.DeleteRecords,
      params: {
        tableId: payload.tableId,
      },
      result: {
        records: payload.records,
      },
      operationId: payload.operationId,
    };
  }

  async undo(operation: IDeleteRecordsOperation) {
    const { params, result, operationId = '' } = operation;

    const count = await this.prismaService.tableTrash.count({
      where: { id: operationId },
    });

    if (operationId && Number(count) === 0) return operation;

    await this.prismaService.$tx(
      async (prisma) => {
        await this.recordOpenApiService.multipleCreateRecords(params.tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: result.records,
        });

        if (operationId) {
          const recordIds = result.records.map((record) => record.id);

          await prisma.tableTrash.delete({
            where: { id: operationId },
          });
          await prisma.recordTrash.deleteMany({
            where: {
              tableId: params.tableId,
              recordId: { in: recordIds },
            },
          });
        }
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );

    return operation;
  }

  async redo(operation: IDeleteRecordsOperation) {
    const { params, result } = operation;
    const { tableId } = params;

    await this.recordOpenApiService.deleteRecords(
      tableId,
      result.records.map((record) => record.id)
    );

    return operation;
  }
}
