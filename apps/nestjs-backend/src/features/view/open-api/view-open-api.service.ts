import { Injectable } from '@nestjs/common';
import type { IViewSnapshot } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { IViewInstance } from '../model/factory';

@Injectable()
export class ViewOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService
  ) {}

  async createView(tableId: string, viewInstance: IViewInstance) {
    const result = await this.createView2Ops(tableId, viewInstance);
    const viewId = result.createSnapshot.view.id;
    await this.prismaService.$transaction(async (prisma) => {
      this.transactionService.set(tableId, prisma);
      await this.shareDbService.createDocument(tableId, viewId, result.createSnapshot);
      this.transactionService.remove(tableId);
    });
  }

  async createView2Ops(
    tableId: string,
    viewInstance: IViewInstance
  ): Promise<{
    createSnapshot: IViewSnapshot;
  }> {
    const viewAggregate = await this.prismaService.view.aggregate({
      where: { tableId },
      _max: { order: true },
    });

    const maxViewOrder = viewAggregate._max.order || 0;

    const createSnapshot = OpBuilder.creator.addView.build(
      {
        ...viewInstance,
      },
      maxViewOrder + 1
    );

    return {
      createSnapshot,
    };
  }
}
