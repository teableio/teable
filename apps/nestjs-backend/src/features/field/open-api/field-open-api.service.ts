import { Injectable } from '@nestjs/common';
import { FieldType, generateTransactionKey, IdPrefix, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldSupplementService } from '../field-supplement.service';
import type { IFieldInstance } from '../model/factory';

@Injectable()
export class FieldOpenApiService {
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldSupplementService: FieldSupplementService
  ) {}

  async createField(
    tableId: string,
    fieldInstance: IFieldInstance,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const fields = [fieldInstance];
    if (fieldInstance.type === FieldType.Link) {
      transactionMeta = transactionMeta ?? {
        transactionKey: generateTransactionKey(),
        opCount: 2,
      };
      const prisma = await this.transactionService.getTransaction(transactionMeta);
      const symmetricField = await this.fieldSupplementService.supplementByCreate(
        prisma,
        tableId,
        fieldInstance
      );
      fields.push(symmetricField);
    }

    for (const field of fields) {
      const snapshot = this.createField2Ops(tableId, field);
      const id = snapshot.field.id;
      const collection = `${IdPrefix.Field}_${tableId}`;
      const doc = this.shareDbService.connect().get(collection, id);
      await new Promise<Doc>((resolve, reject) => {
        doc.create(snapshot, undefined, transactionMeta, (error) => {
          if (error) return reject(error);
          // console.log(`create document ${collectionId}.${id} succeed!`);
          resolve(doc);
        });
      });
    }
  }

  createField2Ops(_tableId: string, fieldInstance: IFieldInstance) {
    return OpBuilder.creator.addField.build({
      ...fieldInstance,
    });
  }
}
