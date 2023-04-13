import { IdPrefix, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import type { ShareDbService } from 'server/services/share-db/share-db.service';
import { shareDbService } from 'server/services/share-db/share-db.service';
import type { IFieldInstance } from '../model/factory';

export class FieldOpenApiService {
  constructor(private readonly shareDbService: ShareDbService) {}

  async createField(
    tableId: string,
    fieldInstance: IFieldInstance,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const snapshot = await this.createField2Ops(tableId, fieldInstance);
    const id = snapshot.field.id;
    const collection = `${IdPrefix.Field}_${tableId}`;
    const doc = this.shareDbService.connect().get(collection, id);
    return new Promise<Doc>((resolve, reject) => {
      doc.create(snapshot, undefined, transactionMeta, (error) => {
        if (error) return reject(error);
        // console.log(`create document ${collectionId}.${id} succeed!`);
        resolve(doc);
      });
    });
  }

  async createField2Ops(_tableId: string, fieldInstance: IFieldInstance) {
    return OpBuilder.creator.addField.build({
      ...fieldInstance,
    });
  }
}

export const fieldOpenApiService = new FieldOpenApiService(shareDbService);
