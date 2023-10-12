import { Injectable, Logger } from '@nestjs/common';
import type {
  IColumnMeta,
  IViewVo,
  IManualSortRo,
  IFieldVo,
  IOtOperation,
} from '@teable-group/core';
import { FieldOpBuilder, IdPrefix, OpName, ViewOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { ShareDbService } from '../../../share-db/share-db.service';
import { FieldService } from '../../field/field.service';
import { RecordService } from '../../record/record.service';
import type { IViewInstance } from '../model/factory';
import { ViewService } from '../view.service';

@Injectable()
export class ViewOpenApiService {
  private logger = new Logger(ViewOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly recordService: RecordService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService
  ) {}

  async createView(tableId: string, viewInstance: IViewInstance) {
    return await this.prismaService.$tx(async () => {
      return await this.createViewWithOrder(tableId, viewInstance);
    });
  }

  async deleteView(tableId: string, viewId: string) {
    return await this.prismaService.$tx(async () => {
      return await this.deleteViewAndColumnMeta(tableId, viewId);
    });
  }

  private async createViewWithOrder(
    tableId: string,
    viewInstance: IViewInstance
  ): Promise<IViewVo> {
    const maxViewOrder = await this.getMaxViewOrder(tableId);
    const view = this.createView2Ops(viewInstance, maxViewOrder);
    const viewId = view.id;
    const collection = `${IdPrefix.View}_${tableId}`;

    await this.createDoc(collection, viewId, view);
    await this.updateColumnMetaForFields(viewId, tableId, OpName.AddColumnMeta);
    return view;
  }

  private async deleteViewAndColumnMeta(tableId: string, viewId: string) {
    const collection = `${IdPrefix.View}_${tableId}`;
    await this.updateColumnMetaForFields(viewId, tableId, OpName.DeleteColumnMeta);
    return await this.deleteDoc(collection, viewId);
  }

  private async getMaxViewOrder(tableId: string): Promise<number> {
    const viewAggregate = await this.prismaService.txClient().view.aggregate({
      where: { tableId, deletedTime: null },
      _max: { order: true },
    });
    return viewAggregate._max.order || 0;
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
      const collection = `${IdPrefix.Field}_${tableId}`;
      const doc = this.shareDbService.getConnection().get(collection, field.id);

      let data: IOtOperation;
      if (opName === OpName.AddColumnMeta) {
        data = this.addColumnMeta2Op(viewId, index);
      } else {
        data = this.deleteColumnMeta2Op(viewId, JSON.parse(field.columnMeta));
      }

      await new Promise((resolve, reject) => {
        doc.fetch(() => {
          doc.submitOp(data, undefined, (error) => {
            if (error) return reject(error);
            resolve(undefined);
          });
        });
      });
    }
  }

  private async createDoc(
    collection: string,
    viewId: string,
    createSnapshot: IViewVo
  ): Promise<IViewVo> {
    const doc = this.shareDbService.getConnection().get(collection, viewId);

    return new Promise<IViewVo>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        this.logger.log(`create document ${collection}.${viewId} succeed!`);
        resolve(doc.data);
      });
    });
  }

  private async deleteDoc(collection: string, viewId: string): Promise<IViewVo> {
    const doc = this.shareDbService.getConnection().get(collection, viewId);

    return new Promise<IViewVo>((resolve, reject) => {
      doc.fetch(() => {
        doc.del({}, (error) => {
          if (error) return reject(error);
          this.logger.log(`delete document ${collection}.${viewId} succeed!`);
          resolve(doc.data);
        });
      });
    });
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

  // submit ops in backend side
  private async submitOps(tableId: string, viewId: string, ops: IOtOperation) {
    const doc = this.shareDbService.getConnection().get(`${IdPrefix.View}_${tableId}`, viewId);

    return new Promise((resolve, reject) => {
      doc.fetch((error) => {
        if (error) return reject(error);
        doc.submitOp(ops, undefined, (error) => {
          error ? reject(error) : resolve(doc.data);
        });
      });
    });
  }

  createView2Ops(viewInstance: IViewInstance, maxViewOrder: number) {
    return ViewOpBuilder.creator.build({
      ...(instanceToPlain(viewInstance, { excludePrefixes: ['_'] }) as IViewVo),
      order: maxViewOrder + 1,
    });
  }

  async manualSort(tableId: string, viewId: string, viewOrderRo: IManualSortRo) {
    const { sortObjs } = viewOrderRo;
    const dbTableName = await this.recordService.getDbTableName(tableId);
    const fields = await this.fieldService.getFields(tableId, { viewId });
    const fieldIndexId = this.viewService.getRowIndexFieldName(viewId);
    const fieldIndexName = this.viewService.getRowIndexFieldIndexName(viewId);

    const defaultView = await this.prismaService.view.findFirstOrThrow({
      select: { id: true, sort: true },
      where: {
        tableId,
        ...(viewId ? { id: viewId } : {}),
        deletedTime: null,
      },
    });

    const fieldMap = fields.reduce((map, field) => {
      map[field.id] = field;
      return map;
    }, {} as Record<string, IFieldVo>);

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
    const ops = ViewOpBuilder.editor.setViewSort.build({
      newSort: newSort,
      oldSort: defaultView.sort ? JSON.parse(defaultView.sort) : null,
    });

    // execute sql to update raw order with transaction
    await this.prismaService.$executeRawUnsafe(dropIndexSql);

    await this.prismaService.$tx(async (prisma) => {
      await prisma.$executeRawUnsafe(updateRecordsOrderSql);
      await this.submitOps(tableId, viewId, ops);
    });

    await this.prismaService.$executeRawUnsafe(createIndexSql);
  }
}
