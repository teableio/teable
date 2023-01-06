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
    await this.shareDbService.submitOps(tableId, 'field', ops);
  }

  async createFields2Ops(tableId: string, fieldInstance: IFieldInstance) {
    const defaultView = await this.prismaService.view.findFirstOrThrow({
      where: { tableId },
      select: { id: true, columns: true },
    });

    const addFieldOp = OpBuilder.items.addField.build({
      ...fieldInstance.data,
    });

    // we only need build column in default view here
    // because we will build all columns after submit
    const setColumnOrderOp = OpBuilder.items.setColumnMeta.build({
      metaKey: 'order',
      newMetaValue: defaultView.columns.length,
      viewId: defaultView.id,
    });

    return [addFieldOp, setColumnOrderOp];
  }
}
