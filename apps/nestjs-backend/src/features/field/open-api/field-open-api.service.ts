import { Injectable } from '@nestjs/common';
import type { IFieldSnapshot } from '@teable-group/core';
import { IdPrefix, OpBuilder } from '@teable-group/core';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IFieldInstance } from '../model/factory';

@Injectable()
export class FieldOpenApiService {
  constructor(private readonly shareDbService: ShareDbService) {}

  async createField(tableId: string, fieldInstance: IFieldInstance) {
    const result = await this.createField2Ops(tableId, fieldInstance);
    const fieldId = result.createSnapshot.field.id;
    await this.shareDbService.createDocument(
      `${IdPrefix.Field}_${tableId}`,
      fieldId,
      result.createSnapshot
    );
  }

  async createField2Ops(
    tableId: string,
    fieldInstance: IFieldInstance
  ): Promise<{
    createSnapshot: IFieldSnapshot;
  }> {
    const createSnapshot = OpBuilder.creator.addField.build({
      ...fieldInstance,
    });

    return {
      createSnapshot,
    };
  }
}
