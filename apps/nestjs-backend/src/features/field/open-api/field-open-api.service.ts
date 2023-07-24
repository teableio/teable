/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { IFieldVo, IOtOperation, IUpdateFieldRo } from '@teable-group/core';
import { getUniqName, FieldType, IdPrefix, FieldOpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Connection } from '@teable/sharedb/lib/client';
import { instanceToPlain } from 'class-transformer';
import { isEmpty, isEqual } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldBatchCalculationService } from '../../calculation/field-batch-calculation.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
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
    private readonly fieldBatchCalculationService: FieldBatchCalculationService,
    private readonly recordOpenApiService: RecordOpenApiService
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
    brotherFieldTableId: string,
    brotherField: LinkFieldDto
  ) {
    const tableId = brotherField.options.foreignTableId;
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const field = await this.fieldSupplementService.supplementByCreate(
      prisma,
      brotherFieldTableId,
      brotherField
    );
    await this.fieldSupplementService.createReference(prisma, field);

    const snapshot = await this.uniqFieldName(
      prisma,
      tableId,
      this.createField2Ops(tableId, field)
    );
    const id = snapshot.id;
    const collection = `${IdPrefix.Field}_${tableId}`;
    const doc = this.shareDbService.getConnection(transactionKey).get(collection, id);
    return await new Promise<IFieldVo>((resolve, reject) => {
      doc.create(snapshot, (error) => {
        if (error) return reject(error);
        resolve(doc.data);
      });
    });
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

    await this.createDoc(connection, collection, id, snapshot);
    await this.fieldBatchCalculationService.calculateFields(prisma, tableId, [id]);
    return snapshot;
  }

  private async createDoc(
    connection: Connection,
    collection: string,
    id: string,
    createSnapshot: IFieldVo
  ): Promise<IFieldVo> {
    const doc = connection.get(collection, id);
    return new Promise<IFieldVo>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        this.logger.log(`create document ${collection}.${id} succeed!`);
        resolve(doc.data);
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
