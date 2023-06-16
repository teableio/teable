import { Injectable, Logger } from '@nestjs/common';
import type { IViewSnapshot } from '@teable-group/core';
import { IdPrefix, OpBuilder } from '@teable-group/core';
import { instanceToPlain } from 'class-transformer';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { IViewInstance } from '../model/factory';
import type { ViewVo } from '../model/view.vo';

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
      return await this.createCreators(transactionKey, tableId, viewInstance);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.createCreators(transactionKey, tableId, viewInstance);
      }
    );
  }

  private async createCreators(
    transactionKey: string,
    tableId: string,
    viewInstance: IViewInstance
  ): Promise<ViewVo> {
    const maxViewOrder = await this.getMaxViewOrder(transactionKey, tableId);
    const createSnapshot = this.createView2Ops(viewInstance, maxViewOrder);
    const id = createSnapshot.view.id;
    const collection = `${IdPrefix.View}_${tableId}`;

    await this.createDoc(transactionKey, collection, id, createSnapshot);

    return createSnapshot.view;
  }

  private async getMaxViewOrder(transactionKey: string, tableId: string): Promise<number> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const viewAggregate = await prisma.view.aggregate({
      where: { tableId, deletedTime: null },
      _max: { order: true },
    });
    return viewAggregate._max.order || 0;
  }

  private async createDoc(
    transactionKey: string,
    collection: string,
    id: string,
    createSnapshot: IViewSnapshot
  ): Promise<IViewSnapshot> {
    const doc = this.shareDbService.getConnection(transactionKey).get(collection, id);

    return new Promise<IViewSnapshot>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        this.logger.log(`create document ${collection}.${id} succeed!`);
        resolve(doc.data);
      });
    });
  }

  createView2Ops(viewInstance: IViewInstance, maxViewOrder: number) {
    return OpBuilder.creator.addView.build({
      ...(instanceToPlain(viewInstance, { excludePrefixes: ['_'] }) as ViewVo),
      order: maxViewOrder + 1,
    });
  }
}
