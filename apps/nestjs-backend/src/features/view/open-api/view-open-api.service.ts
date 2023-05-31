import { Injectable } from '@nestjs/common';
import type { IViewSnapshot } from '@teable-group/core';
import { generateTransactionKey, IdPrefix, OpBuilder } from '@teable-group/core';
import { instanceToPlain } from 'class-transformer';
import type { ITransactionMeta } from 'src/share-db/transaction.service';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { ITransactionCreator } from '../../../utils/transaction-creator';
import type { IViewInstance } from '../model/factory';
import type { ViewVo } from '../model/view.vo';

@Injectable()
export class ViewOpenApiService implements ITransactionCreator {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService
  ) {}

  async createView(tableId: string, viewInstance: IViewInstance) {
    const viewAggregate = await this.prismaService.view.aggregate({
      where: { tableId, deletedTime: null },
      _max: { order: true },
    });

    const maxViewOrder = viewAggregate._max.order || 0;

    const { creators, opMeta } = this.generateCreators(tableId, viewInstance, maxViewOrder);
    const transactionMeta = {
      transactionKey: generateTransactionKey(),
      opCount: 1,
    };
    await creators[0](transactionMeta);
    return opMeta;
  }

  generateCreators(tableId: string, viewInstance: IViewInstance, maxViewOrder: number) {
    const createSnapshot = this.createView2Ops(viewInstance, maxViewOrder);
    const id = createSnapshot.view.id;
    const collection = `${IdPrefix.View}_${tableId}`;
    const doc = this.shareDbService.connect().get(collection, id);

    return {
      creators: [
        (transactionMeta: ITransactionMeta) => {
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
