import { Injectable } from '@nestjs/common';
import type { IViewSnapshot } from '@teable-group/core';
import { IdPrefix, OpBuilder } from '@teable-group/core';
import { instanceToPlain } from 'class-transformer';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
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
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (prisma, transactionKey) => {
        const viewAggregate = await prisma.view.aggregate({
          where: { tableId, deletedTime: null },
          _max: { order: true },
        });

        const maxViewOrder = viewAggregate._max.order || 0;

        const { creators, opMeta } = this.createCreators(tableId, viewInstance, maxViewOrder);
        await creators[0](transactionKey);
        return opMeta;
      }
    );
  }

  createCreators(tableId: string, viewInstance: IViewInstance, maxViewOrder: number) {
    const createSnapshot = this.createView2Ops(viewInstance, maxViewOrder);
    const id = createSnapshot.view.id;
    return {
      creators: [
        (transactionKey: string) => {
          const collection = `${IdPrefix.View}_${tableId}`;
          const doc = this.shareDbService.getConnection(transactionKey).get(collection, id);
          return new Promise<IViewSnapshot>((resolve, reject) => {
            doc.create(createSnapshot, (error) => {
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
