import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IFieldVo, ILinkFieldOptions } from '@teable-group/core';
import { FieldOpBuilder, IdPrefix, FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { Connection } from '@teable/sharedb/lib/client';
import { ShareDbService } from '../../../share-db/share-db.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { FieldSupplementService } from '../field-supplement.service';

@Injectable()
export class FieldDeletingService {
  private logger = new Logger(FieldDeletingService.name);

  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly prismaService: PrismaService,
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

  async cleanRef(connection: Connection, tableId: string, fieldId: string, isLinkField?: boolean) {
    const collection = `${IdPrefix.Field}_${tableId}`;
    const errorRefFieldIds = await this.fieldSupplementService.deleteReference(fieldId);
    const errorLookupFieldIds =
      isLinkField && (await this.fieldSupplementService.deleteLookupFieldReference(fieldId));

    const errorFieldIds = errorLookupFieldIds
      ? errorRefFieldIds.concat(errorLookupFieldIds)
      : errorRefFieldIds;
    await this.markFieldsAsError(connection, collection, errorFieldIds);

    return this.cleanField(connection, tableId, errorFieldIds.concat(fieldId));
  }

  async delateAndCleanRef(
    connection: Connection,
    tableId: string,
    fieldId: string,
    isLinkField?: boolean
  ) {
    const collection = `${IdPrefix.Field}_${tableId}`;
    const rawOpsMap = await this.cleanRef(connection, tableId, fieldId, isLinkField);
    const snapshot = await this.deleteDoc(connection, collection, fieldId);
    return { snapshot, rawOpsMap };
  }

  async cleanField(connection: Connection, tableId: string, fieldIds: string[]) {
    // src is a unique id for the client used by sharedb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = (connection.agent as any).clientId;
    return await this.fieldBatchCalculationService.calculateFields(src, tableId, fieldIds, true);
  }

  async deleteField(tableId: string, fieldId: string): Promise<IFieldVo> {
    const connection = this.shareDbService.getConnection();
    const { type, isLookup, options } = await this.prismaService
      .txClient()
      .field.findUniqueOrThrow({
        where: { id: fieldId },
        select: { type: true, isLookup: true, options: true },
      })
      .catch(() => {
        throw new NotFoundException(`field ${fieldId} not found`);
      });

    if (type === FieldType.Link && !isLookup) {
      const linkFieldOptions: ILinkFieldOptions = JSON.parse(options as string);
      const { foreignTableId, symmetricFieldId } = linkFieldOptions;
      await this.fieldSupplementService.cleanForeignKey(tableId, linkFieldOptions);
      const result1 = await this.delateAndCleanRef(connection, tableId, fieldId, true);
      const result2 = await this.delateAndCleanRef(
        connection,
        foreignTableId,
        symmetricFieldId,
        true
      );
      result1.rawOpsMap && this.shareDbService.publishOpsMap(result1.rawOpsMap);
      result2.rawOpsMap && this.shareDbService.publishOpsMap(result2.rawOpsMap);
      return result1.snapshot;
    }
    const result = await this.delateAndCleanRef(connection, tableId, fieldId);
    result.rawOpsMap && this.shareDbService.publishOpsMap(result.rawOpsMap);
    return result.snapshot;
  }
}
