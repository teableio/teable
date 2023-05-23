/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { FieldType, generateTransactionKey, IdPrefix, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import { instanceToPlain } from 'class-transformer';
import { isEmpty } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRo, createFieldInstanceByVo } from '../model/factory';
import type { FieldVo } from '../model/field.vo';
import type { UpdateFieldRo } from '../model/update-field.ro';

@Injectable()
export class FieldOpenApiService {
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldService: FieldService
  ) {}

  async createField(
    tableId: string,
    fieldInstance: IFieldInstance,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const fieldsWithTableId = [{ tableId, field: fieldInstance }];
    transactionMeta = transactionMeta ?? {
      transactionKey: generateTransactionKey(),
      opCount: 1,
    };
    if (fieldInstance.type === FieldType.Link) {
      transactionMeta = { ...transactionMeta, opCount: transactionMeta.opCount + 1 };
      const prisma = await this.transactionService.getTransaction(transactionMeta);
      const symmetricField = await this.fieldSupplementService.supplementByCreate(
        prisma,
        tableId,
        fieldInstance
      );
      fieldsWithTableId.push({
        tableId: fieldInstance.options.foreignTableId,
        field: symmetricField,
      });
    }

    const prisma = await this.transactionService.getTransaction(transactionMeta);
    await this.fieldSupplementService.createReference(
      prisma,
      fieldsWithTableId.map((f) => f.field)
    );

    let fieldVo: FieldVo | undefined;
    for (const item of fieldsWithTableId) {
      const snapshot = this.createField2Ops(item.tableId, item.field);
      if (item.tableId === tableId) {
        fieldVo = snapshot.field;
      }
      const id = snapshot.field.id;
      const collection = `${IdPrefix.Field}_${item.tableId}`;
      const doc = this.shareDbService.connect().get(collection, id);
      await new Promise<Doc>((resolve, reject) => {
        doc.create(snapshot, undefined, transactionMeta, (error) => {
          if (error) return reject(error);
          // console.log(`create document ${collectionId}.${id} succeed!`);
          resolve(doc);
        });
      });
    }

    return fieldVo!;
  }

  createField2Ops(_tableId: string, fieldInstance: IFieldInstance) {
    return OpBuilder.creator.addField.build(
      instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as FieldVo
    );
  }

  async updateFieldById(tableId: string, fieldId: string, updateFieldRo: UpdateFieldRo) {
    const fieldVo = await this.fieldService.getField(tableId, fieldId);
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

    const updateKeys = (Object.keys(updateFieldRo) as (keyof UpdateFieldRo)[]).filter(
      (key) => oldFieldInstance[key] !== newFieldInstance[key]
    );

    const ops = this.updateField2Ops(updateKeys, newFieldInstance, oldFieldInstance);
    const collection = `${IdPrefix.Field}_${tableId}`;
    const doc = this.shareDbService.connect().get(collection, fieldId);
    doc.fetch();
    return new Promise((resolve, reject) => {
      doc.on('load', () => {
        doc.submitOp(ops, { transactionKey: generateTransactionKey(), opCount: 1 }, (error) => {
          if (error) return reject(error);
          resolve(undefined);
        });
      });
    });
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
          case 'defaultValue': {
            return OpBuilder.editor.setFieldDefaultValue.build({
              newDefaultValue: newFieldInstance.defaultValue!,
              oldDefaultValue: oldFieldInstance.defaultValue! || null,
            });
          }
          case 'options': {
            return OpBuilder.editor.setFieldOptions.build({
              newOptions: newFieldInstance.options,
              oldOptions: oldFieldInstance.options,
            });
          }
          default:
            return null;
        }
      })
      .filter((v) => !isEmpty(v)) as IOtOperation[];
  }
}
