import { Injectable } from '@nestjs/common';
import type { IViewSnapshot } from '@teable-group/core';
import { generateTransactionKey, IdPrefix, OpBuilder } from '@teable-group/core';
import { instanceToPlain } from 'class-transformer';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { IBackendTransactionMeta } from '../../../share-db/transaction.service';
import type { ITransactionCreator } from '../../../utils/transaction-creator';
import type { IViewInstance } from '../model/factory';
import type { ViewVo } from '../model/view.vo';

@Injectable()
export class ViewOpenApiService implements ITransactionCreator {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService
  ) {}

  async createView(tableId: string, viewInstance: IViewInstance) {
    return await this.prismaService.$transaction(async (prisma) => {
      const transactionKey = generateTransactionKey();
      this.transactionService.newBackendTransaction(transactionKey, prisma);
      try {
        const viewAggregate = await prisma.view.aggregate({
          where: { tableId, deletedTime: null },
          _max: { order: true },
        });

        const maxViewOrder = viewAggregate._max.order || 0;

        const { creators, opMeta } = this.createCreators(tableId, viewInstance, maxViewOrder);
        await creators[0]({ transactionKey, isBackend: true });
        return opMeta;
      } finally {
        this.transactionService.completeBackendTransaction(transactionKey);
      }
    });
  }

  createCreators(tableId: string, viewInstance: IViewInstance, maxViewOrder: number) {
    const createSnapshot = this.createView2Ops(viewInstance, maxViewOrder);
    const id = createSnapshot.view.id;
    const collection = `${IdPrefix.View}_${tableId}`;
    const doc = this.shareDbService.connect().get(collection, id);

    return {
      creators: [
        (transactionMeta: IBackendTransactionMeta) => {
          return new Promise<IViewSnapshot>((resolve, reject) => {
            doc.create(createSnapshot, undefined, transactionMeta, (error) => {
              if (error) return reject(error);
              console.log(`create document ${collection}.${id} succeed!`);
              resolve(doc.data);
            });
          });
        },
      ],
      opMeta: createSnapshot.view,
    };
  }

  createView2Ops(viewInstance: IViewInstance, maxViewOrder: number) {
    return OpBuilder.creator.addView.build({
      ...(instanceToPlain(viewInstance, { excludePrefixes: ['_'] }) as ViewVo),
      order: maxViewOrder + 1,
    });
  }
}
