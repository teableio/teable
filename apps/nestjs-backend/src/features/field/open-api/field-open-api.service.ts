import { Injectable } from '@nestjs/common';
import type { IColumnMeta, IFieldSnapshot, IOtOperation } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IFieldInstance } from '../model/factory';

@Injectable()
export class FieldOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService
  ) {}

  async createField(tableId: string, fieldInstance: IFieldInstance) {
    const result = await this.createField2Ops(tableId, fieldInstance);
    const fieldId = result.createSnapshot.field.id;
    await this.prismaService.$transaction(async (prisma) => {
      const doc = await this.shareDbService.createDocument(tableId, fieldId, result.createSnapshot);
      await new Promise((resolve, reject) => {
        doc.submitOp(
          [result.fieldOperation],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { agentCustom: { transactionClient: prisma } } as any,
          (error) => {
            if (error) return reject(error);
            resolve(undefined);
          }
        );
      });
    });
  }

  async createField2Ops(
    tableId: string,
    fieldInstance: IFieldInstance
  ): Promise<{
    createSnapshot: IFieldSnapshot;
    fieldOperation: IOtOperation;
  }> {
    const fieldsData = await this.prismaService.field.findMany({
      where: { tableId: tableId },
      select: { id: true, columnMeta: true },
    });

    const defaultViewId = Object.keys(JSON.parse(fieldsData[0].columnMeta))[0];

    const maxFieldOrder = fieldsData.reduce((max, fieldData) => {
      const columnMeta: IColumnMeta = JSON.parse(fieldData.columnMeta);
      const order = columnMeta[defaultViewId].order;
      return Math.max(max, order);
    }, -1);

    const createSnapshot = OpBuilder.creator.addField.build({
      ...fieldInstance,
    });

    // we only need build column in default view here
    // because we will build all columns after submit
    const fieldOperation = OpBuilder.editor.addColumnMeta.build({
      viewId: defaultViewId,
      newMetaValue: { order: maxFieldOrder + 1 },
    });

    return {
      createSnapshot,
      fieldOperation,
    };
  }
}
