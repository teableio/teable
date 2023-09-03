import { Injectable, Logger } from '@nestjs/common';
import type { IColumnMeta, IViewVo } from '@teable-group/core';
import { FieldOpBuilder, IdPrefix, OpName, ViewOpBuilder } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { IViewInstance } from '../model/factory';

@Injectable()
export class ViewOpenApiService {
  private logger = new Logger(ViewOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService
  ) {}

  async createView(tableId: string, viewInstance: IViewInstance, transactionKey?: string) {
    if (transactionKey) {
      return await this.createViewWithOrder(transactionKey, tableId, viewInstance);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.createViewWithOrder(transactionKey, tableId, viewInstance);
      }
    );
  }

  async deleteView(tableId: string, viewId: string, transactionKey?: string) {
    if (transactionKey) {
      return await this.deleteViewAndColumnMeta(transactionKey, tableId, viewId);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.deleteViewAndColumnMeta(transactionKey, tableId, viewId);
      }
    );
  }

  private async createViewWithOrder(
    transactionKey: string,
    tableId: string,
    viewInstance: IViewInstance
  ): Promise<IViewVo> {
    const maxViewOrder = await this.getMaxViewOrder(transactionKey, tableId);
    const view = this.createView2Ops(viewInstance, maxViewOrder);
    const viewId = view.id;
    const collection = `${IdPrefix.View}_${tableId}`;

    await this.createDoc(transactionKey, collection, viewId, view);
    await this.updateColumnMetaForFields(transactionKey, viewId, tableId, OpName.AddColumnMeta);
    return view;
  }

  private async deleteViewAndColumnMeta(transactionKey: string, tableId: string, viewId: string) {
    const collection = `${IdPrefix.View}_${tableId}`;
    await this.updateColumnMetaForFields(transactionKey, viewId, tableId, OpName.DeleteColumnMeta);
    return await this.deleteDoc(transactionKey, collection, viewId);
  }

  private async getMaxViewOrder(transactionKey: string, tableId: string): Promise<number> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const viewAggregate = await prisma.view.aggregate({
      where: { tableId, deletedTime: null },
      _max: { order: true },
    });
    return viewAggregate._max.order || 0;
  }

  private async updateColumnMetaForFields(
    transactionKey: string,
    viewId: string,
    tableId: string,
    opName: OpName.AddColumnMeta | OpName.DeleteColumnMeta
  ) {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const fields = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, columnMeta: true },
    });

    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      const collection = `${IdPrefix.Field}_${tableId}`;
      const doc = this.shareDbService.getConnection(transactionKey).get(collection, field.id);

      let data: unknown;
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
    transactionKey: string,
    collection: string,
    viewId: string,
    createSnapshot: IViewVo
  ): Promise<IViewVo> {
    const doc = this.shareDbService.getConnection(transactionKey).get(collection, viewId);

    return new Promise<IViewVo>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        this.logger.log(`create document ${collection}.${viewId} succeed!`);
        resolve(doc.data);
      });
    });
  }

  private async deleteDoc(
    transactionKey: string,
    collection: string,
    viewId: string
  ): Promise<IViewVo> {
    const doc = this.shareDbService.getConnection(transactionKey).get(collection, viewId);

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

  createView2Ops(viewInstance: IViewInstance, maxViewOrder: number) {
    return ViewOpBuilder.creator.build({
      ...(instanceToPlain(viewInstance, { excludePrefixes: ['_'] }) as IViewVo),
      order: maxViewOrder + 1,
    });
  }
}
