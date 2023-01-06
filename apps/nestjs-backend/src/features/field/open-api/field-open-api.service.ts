import { Injectable } from '@nestjs/common';
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
    const ops = await this.createFields2Ops(tableId, fieldInstance);
    await this.shareDbService.submitOps('table', tableId, ops);
  }

  async createFields2Ops(tableId: string, fieldInstance: IFieldInstance) {
    const defaultView = await this.prismaService.view.findFirstOrThrow({
      where: { tableId },
      select: { id: true, columns: true },
    });

    const addFieldOp = OpBuilder.items.addField.build({
      ...fieldInstance.data,
    });
    const addColumnOp = OpBuilder.items.addColumn.build({
      columnIndex: defaultView.columns.length,
      viewId: defaultView.id,
      column: {
        fieldId: fieldInstance.data.id,
      },
    });

    return [addFieldOp, addColumnOp];
  }
}
