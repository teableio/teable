import { Injectable, Logger } from '@nestjs/common';
import type { IFieldVo, IUpdateFieldRo } from '@teable-group/core';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { IFieldInstance } from '../model/factory';
import { FieldConvertingService } from './field-converting.service';
import { FieldCreatingService } from './field-creating.service';
import { FieldDeletingService } from './field-deleting.service';

@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldDeletingService: FieldDeletingService,
    private readonly fieldConvertingService: FieldConvertingService
  ) {}

  async createField(tableId: string, fieldInstance: IFieldInstance, transactionKey?: string) {
    if (transactionKey) {
      return await this.fieldCreatingService.createField(transactionKey, tableId, fieldInstance);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.fieldCreatingService.createField(transactionKey, tableId, fieldInstance);
      }
    );
  }

  async deleteField(tableId: string, fieldId: string, transactionKey?: string) {
    if (transactionKey) {
      return await this.fieldDeletingService.deleteField(transactionKey, tableId, fieldId);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.fieldDeletingService.deleteField(transactionKey, tableId, fieldId);
      }
    );
  }

  async updateFieldById(
    tableId: string,
    fieldId: string,
    updateFieldRo: IUpdateFieldRo
  ): Promise<IFieldVo> {
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.fieldConvertingService.updateFieldById(
          transactionKey,
          tableId,
          fieldId,
          updateFieldRo
        );
      }
    );
  }
}
