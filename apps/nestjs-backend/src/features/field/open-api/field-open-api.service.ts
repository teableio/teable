/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { IFieldSnapshot, IOtOperation } from '@teable-group/core';
import { getUniqName, FieldType, IdPrefix, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { isEmpty, isEqual } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRo, createFieldInstanceByVo } from '../model/factory';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import type { FieldVo } from '../model/field.vo';
import type { UpdateFieldRo } from '../model/update-field.ro';

@Injectable()
export class FieldOpenApiService {
  private logger = new Logger(FieldOpenApiService.name);
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldService: FieldService
  ) {}

  async createField(tableId: string, fieldInstance: IFieldInstance, transactionKey?: string) {
    if (transactionKey) {
      return await this.fieldCreator(transactionKey, tableId, fieldInstance);
    }

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        return await this.fieldCreator(transactionKey, tableId, fieldInstance);
      }
    );
  }

  async uniqFieldName(prisma: Prisma.TransactionClient, tableId: string, snapshot: IFieldSnapshot) {
    const fieldRaw = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: { name: true },
    });

    const names = fieldRaw.map((item) => item.name);
    const uniqName = getUniqName(snapshot.field.name, names);
    if (uniqName !== snapshot.field.name) {
      return {
        ...snapshot,
        field: {
          ...snapshot.field,
          name: uniqName,
        },
      };
    }
    return snapshot;
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
    const id = snapshot.field.id;
    const collection = `${IdPrefix.Field}_${tableId}`;
    const doc = this.shareDbService.getConnection(transactionKey).get(collection, id);
    return await new Promise<IFieldSnapshot>((resolve, reject) => {
      doc.create(snapshot, (error) => {
        if (error) return reject(error);
        resolve(doc.data);
      });
    });
  }

  private async fieldCreator(
    transactionKey: string,
    tableId: string,
    field: IFieldInstance
  ): Promise<FieldVo> {
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

    const id = snapshot.field.id;
    const collection = `${IdPrefix.Field}_${tableId}`;

    await this.createDoc(transactionKey, collection, id, snapshot);

    return snapshot.field;
  }

  private async createDoc(
    transactionKey: string,
    collection: string,
    id: string,
    createSnapshot: IFieldSnapshot
  ): Promise<IFieldSnapshot> {
    const doc = this.shareDbService.getConnection(transactionKey).get(collection, id);

    return new Promise<IFieldSnapshot>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        this.logger.log(`create document ${collection}.${id} succeed!`);
        resolve(doc.data);
      });
    });
  }

  createField2Ops(_tableId: string, fieldInstance: IFieldInstance) {
    return OpBuilder.creator.addField.build(
      instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as FieldVo
    );
  }

  async updateFieldById(tableId: string, fieldId: string, updateFieldRo: UpdateFieldRo) {
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
        const updateKeys = (Object.keys(updateFieldRo) as (keyof UpdateFieldRo)[]).filter(
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
            return OpBuilder.editor.setFieldName.build({
              newName: newFieldInstance.name,
              oldName: oldFieldInstance.name,
            });
          }
          case 'description': {
            return OpBuilder.editor.setFieldDescription.build({
              newDescription: newFieldInstance.description!,
              oldDescription: oldFieldInstance.description!,
            });
          }
          case 'type': {
            return OpBuilder.editor.setFieldType.build({
              newType: newFieldInstance.type,
              oldType: oldFieldInstance.type,
            });
          }
          case 'options': {
            return OpBuilder.editor.setFieldOptions.build({
              newOptions: newFieldInstance.options,
              oldOptions: oldFieldInstance.options,
            });
          }
          case 'isLookup': {
            return OpBuilder.editor.setFieldOptions.build({
              newOptions: newFieldInstance.isLookup,
              oldOptions: oldFieldInstance.isLookup,
            });
          }
          case 'lookupOptions': {
            return OpBuilder.editor.setFieldOptions.build({
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
