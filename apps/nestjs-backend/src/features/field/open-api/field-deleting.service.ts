import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IFieldVo, ILinkFieldOptions } from '@teable-group/core';
import { FieldOpBuilder, IdPrefix, FieldType } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Connection } from '@teable/sharedb/lib/client';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { FieldSupplementService } from '../field-supplement.service';

@Injectable()
export class FieldDeletingService {
  private logger = new Logger(FieldDeletingService.name);

  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldBatchCalculationService: FieldCalculationService
  ) {}

  private async deleteDoc(
    connection: Connection,
    collection: string,
    id: string
  ): Promise<IFieldVo> {
    const doc = connection.get(collection, id);
    return new Promise<IFieldVo>((resolve, reject) => {
      doc.fetch((error) => {
        if (error) return reject(error);
        doc.del({}, (error) => {
          if (error) return reject(error);
          this.logger.log(`delete document ${collection}.${id} succeed!`);
          resolve(doc.data);
        });
      });
    });
  }

  private async markFieldsAsError(connection: Connection, collection: string, fieldIds: string[]) {
    const promises = fieldIds.map((fieldId) => {
      const op = FieldOpBuilder.editor.setFieldProperty.build({
        key: 'hasError',
        oldValue: undefined,
        newValue: true,
      });
      const doc = connection.get(collection, fieldId);
      return new Promise<IFieldVo>((resolve, reject) => {
        doc.fetch((error) => {
          if (error) return reject(error);
          doc.submitOp([op], undefined, (error) => {
            error ? reject(error) : resolve(doc.data);
          });
        });
      });
    });
    return await Promise.all(promises);
  }

  async delateAndCleanRef(
    prisma: Prisma.TransactionClient,
    connection: Connection,
    tableId: string,
    fieldId: string,
    isLinkField?: boolean
  ) {
    const collection = `${IdPrefix.Field}_${tableId}`;
    const errorRefFieldIds = await this.fieldSupplementService.deleteReference(prisma, fieldId);
    const errorLookupFieldIds =
      isLinkField &&
      (await this.fieldSupplementService.deleteLookupFieldReference(prisma, fieldId));

    const errorFieldIds = errorLookupFieldIds
      ? errorRefFieldIds.concat(errorLookupFieldIds)
      : errorRefFieldIds;
    await this.markFieldsAsError(connection, collection, errorFieldIds);

    // src is a unique id for the client used by sharedb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = (connection.agent as any).clientId;
    const rawOpsMap = await this.fieldBatchCalculationService.calculateFields(
      prisma,
      src,
      tableId,
      errorFieldIds.concat(fieldId),
      true
    );

    const snapshot = await this.deleteDoc(connection, collection, fieldId);
    return { snapshot, rawOpsMap };
  }

  async deleteField(transactionKey: string, tableId: string, fieldId: string): Promise<IFieldVo> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const connection = this.shareDbService.getConnection(transactionKey);
    const { type, isLookup, options } = await prisma.field
      .findUniqueOrThrow({
        where: { id: fieldId },
        select: { type: true, isLookup: true, options: true },
      })
      .catch(() => {
        throw new NotFoundException(`field ${fieldId} not found`);
      });

    if (type === FieldType.Link && !isLookup) {
      const linkFieldOptions: ILinkFieldOptions = JSON.parse(options as string);
      const { foreignTableId, symmetricFieldId } = linkFieldOptions;
      await this.fieldSupplementService.cleanForeignKey(prisma, tableId, linkFieldOptions);
      const result1 = await this.delateAndCleanRef(prisma, connection, tableId, fieldId, true);
      const result2 = await this.delateAndCleanRef(
        prisma,
        connection,
        foreignTableId,
        symmetricFieldId,
        true
      );
      result1.rawOpsMap && this.shareDbService.publishOpsMap(result1.rawOpsMap);
      result2.rawOpsMap && this.shareDbService.publishOpsMap(result2.rawOpsMap);
      return result1.snapshot;
    }
    const result = await this.delateAndCleanRef(prisma, connection, tableId, fieldId);
    result.rawOpsMap && this.shareDbService.publishOpsMap(result.rawOpsMap);
    return result.snapshot;
  }
}
