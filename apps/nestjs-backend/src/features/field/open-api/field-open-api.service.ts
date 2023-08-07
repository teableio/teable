/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IFieldVo, ILinkFieldOptions, IOtOperation, IUpdateFieldRo } from '@teable-group/core';
import { getUniqName, FieldType, IdPrefix, FieldOpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Connection } from '@teable/sharedb/lib/client';
import { instanceToPlain } from 'class-transformer';
import { isEmpty, isEqual, noop } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { Timing } from '../../../utils/timing';
import {
  IRawOpMap,
  FieldBatchCalculationService,
} from '../../calculation/field-batch-calculation.service';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRo, createFieldInstanceByVo } from '../model/factory';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';

@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldService: FieldService,
    private readonly fieldBatchCalculationService: FieldBatchCalculationService
  ) {}

  async createField(tableId: string, fieldInstance: IFieldInstance, transactionKey?: string) {
    if (transactionKey) {
      return await this.createFieldInner(transactionKey, tableId, fieldInstance);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.createFieldInner(transactionKey, tableId, fieldInstance);
      }
    );
  }

  async deleteField(tableId: string, fieldId: string, transactionKey?: string) {
    if (transactionKey) {
      return await this.deleteFieldInner(transactionKey, tableId, fieldId);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.deleteFieldInner(transactionKey, tableId, fieldId);
      }
    );
  }

  async uniqFieldName(prisma: Prisma.TransactionClient, tableId: string, field: IFieldVo) {
    const fieldRaw = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: { name: true },
    });

    const names = fieldRaw.map((item) => item.name);
    const uniqName = getUniqName(field.name, names);
    if (uniqName !== field.name) {
      return {
        ...field,
        name: uniqName,
      };
    }
    return field;
  }

  private async createSupplementFields(
    transactionKey: string,
    tableId: string,
    field: LinkFieldDto
  ) {
    const foreignTableId = field.options.foreignTableId;
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const symmetricField = await this.fieldSupplementService.createSupplementation(
      prisma,
      tableId,
      field
    );
    await this.fieldSupplementService.createReference(prisma, symmetricField);

    const snapshot = await this.uniqFieldName(
      prisma,
      foreignTableId,
      this.createField2Ops(foreignTableId, symmetricField)
    );

    const collection = `${IdPrefix.Field}_${foreignTableId}`;
    const connection = this.shareDbService.getConnection(transactionKey);
    return await this.createDoc(connection, collection, snapshot);
  }

  private async deleteSupplementFields(
    transactionKey: string,
    linkFieldOptions: ILinkFieldOptions
  ) {
    const { symmetricFieldId, foreignTableId } = linkFieldOptions;
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const collection = `${IdPrefix.Field}_${foreignTableId}`;
    const connection = this.shareDbService.getConnection(transactionKey);
    await this.deleteDoc(connection, collection, symmetricFieldId);

    const errorFieldIds = await this.fieldSupplementService.deleteReference(
      prisma,
      symmetricFieldId
    );
    const errorLookupIds = await this.fieldSupplementService.deleteLookupFieldReference(
      prisma,
      symmetricFieldId
    );
    return errorFieldIds.concat(errorLookupIds);
  }

  private async createFieldInner(
    transactionKey: string,
    tableId: string,
    field: IFieldInstance
  ): Promise<IFieldVo> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    await this.fieldSupplementService.createReference(prisma, field);

    if (field.type === FieldType.Link && !field.isLookup) {
      await this.createSupplementFields(transactionKey, tableId, field);
    }

    const snapshot = await this.uniqFieldName(
      prisma,
      tableId,
      this.createField2Ops(tableId, field)
    );

    const id = snapshot.id;
    const collection = `${IdPrefix.Field}_${tableId}`;
    const connection = this.shareDbService.getConnection(transactionKey);
    // src is a unique id for the client used by sharedb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = (connection.agent as any).clientId;
    await this.createDoc(connection, collection, snapshot);
    const rawOpsMap = await this.fieldBatchCalculationService.calculateFields(
      prisma,
      src,
      tableId,
      [id]
    );
    rawOpsMap && this.publishOpsMap(rawOpsMap);
    const { dbFieldName } = await prisma.field.findUniqueOrThrow({
      where: { id },
      select: { dbFieldName: true },
    });
    return {
      ...snapshot,
      dbFieldName,
    };
  }

  private async deleteFieldInner(
    transactionKey: string,
    tableId: string,
    fieldId: string
  ): Promise<IFieldVo> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const { type, isLookup, options } = await prisma.field
      .findUniqueOrThrow({
        where: { id: fieldId },
        select: { type: true, isLookup: true, options: true },
      })
      .catch(() => {
        throw new NotFoundException(`field ${fieldId} not found`);
      });

    const collection = `${IdPrefix.Field}_${tableId}`;
    const connection = this.shareDbService.getConnection(transactionKey);

    const errorFieldIds: string[] = [];
    const refErrorFields = await this.fieldSupplementService.deleteReference(prisma, fieldId);
    errorFieldIds.push(...refErrorFields);

    if (type === FieldType.Link && !isLookup) {
      const linkFieldOptions: ILinkFieldOptions = JSON.parse(options as string);
      const lookupErrorFields = await this.fieldSupplementService.deleteLookupFieldReference(
        prisma,
        fieldId
      );
      await this.fieldSupplementService.deleteForeignKey(prisma, tableId, linkFieldOptions);
      errorFieldIds.push(...lookupErrorFields);
      const errorFieldsBySupply = await this.deleteSupplementFields(
        transactionKey,
        linkFieldOptions
      );
      errorFieldIds.push(...errorFieldsBySupply);
    }

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
    rawOpsMap && this.publishOpsMap(rawOpsMap);
    return snapshot;
  }

  private async markFieldsAsError(connection: Connection, collection: string, fieldIds: string[]) {
    const promises = fieldIds.map((fieldId) => {
      const op = FieldOpBuilder.editor.setFieldHasError.build({
        oldError: false,
        newError: true,
      });
      const doc = connection.get(collection, fieldId);
      return new Promise<IFieldVo>((resolve, reject) => {
        doc.fetch((error) => {
          if (error) reject(error);
          doc.submitOp([op], undefined, (error) => {
            error ? reject(error) : resolve(doc.data);
          });
        });
      });
    });
    return await Promise.all(promises);
  }

  // publish ops to client for realtime sync
  @Timing()
  publishOpsMap(rawOpMap: IRawOpMap) {
    for (const tableId in rawOpMap) {
      const collection = `${IdPrefix.Record}_${tableId}`;
      const data = rawOpMap[tableId];
      for (const recordId in data) {
        const rawOp = data[recordId];
        const channels = [collection, `${collection}.${recordId}`];
        rawOp.c = collection;
        rawOp.d = recordId;
        this.shareDbService.pubsub.publish(channels, rawOp, noop);
      }
    }
  }

  private async createDoc(
    connection: Connection,
    collection: string,
    createSnapshot: IFieldVo
  ): Promise<IFieldVo> {
    const doc = connection.get(collection, createSnapshot.id);
    return new Promise<IFieldVo>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        this.logger.log(`create document ${collection}.${createSnapshot.id} succeed!`);
        resolve(doc.data);
      });
    });
  }

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

  createField2Ops(_tableId: string, fieldInstance: IFieldInstance) {
    return FieldOpBuilder.creator.build(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as IFieldVo
    );
  }

  async updateFieldById(tableId: string, fieldId: string, updateFieldRo: IUpdateFieldRo) {
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (prisma, transactionKey) => {
        const fieldVo = await this.fieldService.getField(tableId, fieldId, prisma);
        if (!fieldVo) {
          throw new HttpException(`Not found fieldId(${fieldId})`, HttpStatus.NOT_FOUND);
        }

        const oldFieldInstance = createFieldInstanceByVo(fieldVo);

        let newFieldInstance: IFieldInstance;
        try {
          newFieldInstance = createFieldInstanceByRo({
            ...fieldVo,
            ...updateFieldRo,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
        }

        // Avoid some unnecessary changes, first differences to find out the key with changes
        const updateKeys = (Object.keys(updateFieldRo) as (keyof IUpdateFieldRo)[]).filter(
          (key) => !isEqual(fieldVo[key], updateFieldRo[key])
        );

        const ops = this.updateField2Ops(updateKeys, newFieldInstance, oldFieldInstance);
        const collection = `${IdPrefix.Field}_${tableId}`;
        const doc = this.shareDbService.getConnection(transactionKey).get(collection, fieldId);
        return new Promise((resolve, reject) => {
          doc.fetch(() => {
            doc.submitOp(ops, undefined, (error) => {
              if (error) return reject(error);
              resolve(undefined);
            });
          });
        });
      }
    );
  }

  updateField2Ops(
    keys: string[],
    newFieldInstance: IFieldInstance,
    oldFieldInstance: IFieldInstance
  ) {
    return keys
      .map((key) => {
        switch (key) {
          case 'name': {
            return FieldOpBuilder.editor.setFieldName.build({
              newName: newFieldInstance.name,
              oldName: oldFieldInstance.name,
            });
          }
          case 'description': {
            return FieldOpBuilder.editor.setFieldDescription.build({
              newDescription: newFieldInstance.description!,
              oldDescription: oldFieldInstance.description!,
            });
          }
          case 'type': {
            return FieldOpBuilder.editor.setFieldType.build({
              newType: newFieldInstance.type,
              oldType: oldFieldInstance.type,
            });
          }
          case 'options': {
            return FieldOpBuilder.editor.setFieldOptions.build({
              newOptions: newFieldInstance.options,
              oldOptions: oldFieldInstance.options,
            });
          }
          case 'isLookup': {
            return FieldOpBuilder.editor.setFieldOptions.build({
              newOptions: newFieldInstance.isLookup,
              oldOptions: oldFieldInstance.isLookup,
            });
          }
          case 'lookupOptions': {
            return FieldOpBuilder.editor.setFieldOptions.build({
              newOptions: newFieldInstance.lookupOptions,
              oldOptions: oldFieldInstance.lookupOptions,
            });
          }
          default:
            return null;
        }
      })
      .filter((v) => !isEmpty(v)) as IOtOperation[];
  }
}
