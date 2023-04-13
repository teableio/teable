import { IdPrefix, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import { prismaClient } from '@/backend/config/container.config';
import { shareDbService } from 'server/services/share-db/share-db.service';
import type { IViewInstance } from '../model/factory';

export class ViewOpenApiService {
  async createView(
    tableId: string,
    viewInstance: IViewInstance,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const createSnapshot = await this.createView2Ops(tableId, viewInstance);
    const id = createSnapshot.view.id;
    const collection = `${IdPrefix.View}_${tableId}`;
    const doc = shareDbService.connect().get(collection, id);
    await new Promise<Doc>((resolve, reject) => {
      doc.create(createSnapshot, undefined, transactionMeta, (error) => {
        if (error) return reject(error);
        console.log(`create document ${collection}.${id} succeed!`);
        resolve(doc);
      });
    });

    return createSnapshot.view;
  }

  async createView2Ops(tableId: string, viewInstance: IViewInstance) {
    const viewAggregate = await prismaClient.view.aggregate({
      where: { tableId },
      _max: { order: true },
    });

    const maxViewOrder = viewAggregate._max.order || 0;

    return OpBuilder.creator.addView.build(
      {
        ...viewInstance,
      },
      maxViewOrder + 1
    );
  }
}

export const viewOpenApiService = new ViewOpenApiService();
