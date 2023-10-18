import { Injectable, Logger } from '@nestjs/common';
import type {
  IColumnMeta,
  IViewVo,
  IManualSortRo,
  IFieldVo,
  IOtOperation,
  IViewRo,
} from '@teable-group/core';
import { FieldOpBuilder, OpName } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { FieldService } from '../../field/field.service';
import { RecordService } from '../../record/record.service';
import { ViewService } from '../view.service';

@Injectable()
export class ViewOpenApiService {
  private logger = new Logger(ViewOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService
  ) {}

  async createView(tableId: string, viewRo: IViewRo) {
    return await this.prismaService.$tx(async () => {
      return await this.createViewInner(tableId, viewRo);
    });
  }

  async deleteView(tableId: string, viewId: string) {
    return await this.prismaService.$tx(async () => {
      return await this.deleteViewInner(tableId, viewId);
    });
  }

  private async createViewInner(tableId: string, viewRo: IViewRo): Promise<IViewVo> {
    const result = await this.viewService.createView(tableId, viewRo);
    await this.updateColumnMetaForFields(result.id, tableId, OpName.AddColumnMeta);
    return result;
  }

  private async deleteViewInner(tableId: string, viewId: string) {
    await this.updateColumnMetaForFields(viewId, tableId, OpName.DeleteColumnMeta);
    await this.viewService.deleteView(tableId, viewId);
  }

  private async updateColumnMetaForFields(
    viewId: string,
    tableId: string,
    opName: OpName.AddColumnMeta | OpName.DeleteColumnMeta
  ) {
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, columnMeta: true },
    });

    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];

      let data: IOtOperation;
      if (opName === OpName.AddColumnMeta) {
        data = this.addColumnMeta2Op(viewId, index);
      } else {
        data = this.deleteColumnMeta2Op(viewId, JSON.parse(field.columnMeta));
      }

      await this.fieldService.batchUpdateFields(tableId, [{ fieldId: field.id, ops: [data] }]);
    }
  }

  private addColumnMeta2Op(viewId: string, order: number) {
    return FieldOpBuilder.editor.addColumnMeta.build({
      viewId,
      newMetaValue: { order },
    });
  }

  private deleteColumnMeta2Op(viewId: string, oldColumnMeta: IColumnMeta) {
    return FieldOpBuilder.editor.deleteColumnMeta.build({
      viewId,
      oldMetaValue: oldColumnMeta[viewId],
    });
  }

  async manualSort(tableId: string, viewId: string, viewOrderRo: IManualSortRo) {
    const { sortObjs } = viewOrderRo;
    const dbTableName = await this.recordService.getDbTableName(tableId);
    const fields = await this.fieldService.getFields(tableId, { viewId });
    const fieldIndexId = this.viewService.getRowIndexFieldName(viewId);
    const fieldIndexName = this.viewService.getRowIndexFieldIndexName(viewId);

    const fieldMap = fields.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldVo>
    );

    const orders = sortObjs.map(({ fieldId, order }) => ({
      column: fieldMap[fieldId].dbFieldName,
      order: order,
    }));

    const orderSql = orders.map(({ column, order }) => `${column} ${order.toUpperCase()}`).join();

    const dropIndexSql = `
      DROP INDEX IF EXISTS ${fieldIndexName};
    `;
    const updateRecordsOrderSql = `
      UPDATE ${dbTableName}
      SET ${fieldIndexId} = new_order
      FROM (
        SELECT t.__id, ROW_NUMBER() OVER (ORDER BY ${orderSql}) as new_order
        FROM ${dbTableName} AS t
      ) AS temp_order
      WHERE temp_order.__id = ${dbTableName}.__id;
    `;
    const createIndexSql = `
      CREATE UNIQUE INDEX ${fieldIndexName}
      ON ${dbTableName} (${fieldIndexId});
    `;

    // build ops
    const newSort = {
      sortObjs: sortObjs,
      shouldAutoSort: false,
    };

    // execute sql to update raw order with transaction
    await this.prismaService.$executeRawUnsafe(dropIndexSql);

    await this.prismaService.$tx(async (prisma) => {
      await prisma.$executeRawUnsafe(updateRecordsOrderSql);
      await this.viewService.updateView(tableId, viewId, { sort: JSON.stringify(newSort) });
    });

    await this.prismaService.$executeRawUnsafe(createIndexSql);
  }
}
