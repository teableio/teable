import { Injectable } from '@nestjs/common';
import type { IColumnMeta } from '@teable-group/core';
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

    const addFieldOp = OpBuilder.items.addField.build({
      ...fieldInstance.data,
    });

    // we only need build column in default view here
    // because we will build all columns after submit
    const setColumnOrderOp = OpBuilder.items.setColumnMeta.build({
      metaKey: 'order',
      viewId: defaultViewId,
      newMetaValue: maxFieldOrder + 1,
    });

    return [addFieldOp, setColumnOrderOp];
  }
}
