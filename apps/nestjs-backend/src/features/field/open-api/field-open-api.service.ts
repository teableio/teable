/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IFieldSnapshot, IOtOperation } from '@teable-group/core';
import { FieldType, IdPrefix, OpBuilder } from '@teable-group/core';
import { instanceToPlain } from 'class-transformer';
import { isEmpty } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { ITransactionCreator } from '../../../utils/transaction-creator';
import { FieldSupplementService } from '../field-supplement.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByRo, createFieldInstanceByVo } from '../model/factory';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import type { FieldVo } from '../model/field.vo';
import type { UpdateFieldRo } from '../model/update-field.ro';

@Injectable()
export class FieldOpenApiService implements ITransactionCreator {
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldService: FieldService
  ) {}

  async createField(tableId: string, fieldInstance: IFieldInstance) {
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        const { creators, opMeta } = this.createCreators(tableId, fieldInstance);
        for (const creator of creators) {
          await creator(transactionKey);
        }
        return opMeta;
      }
    );
  }

  generateFirstCreators(tableId: string, field: IFieldInstance) {
    const snapshot = this.createField2Ops(tableId, field);
    const id = snapshot.field.id;
    return {
      creator: async (transactionKey: string) => {
        const collection = `${IdPrefix.Field}_${tableId}`;
        const doc = this.shareDbService.getConnection(transactionKey).get(collection, id);
        const prisma = this.transactionService.getTransactionSync(transactionKey);
        await this.fieldSupplementService.createReference(prisma, field);
        return await new Promise<IFieldSnapshot>((resolve, reject) => {
          doc.create(snapshot, (error) => {
            if (error) return reject(error);
            // console.log(`create document ${collectionId}.${id} succeed!`);
            resolve(doc.data);
          });
        });
      },
      snapshot,
    };
  }

  generateSecondCreators(brotherFieldTableId: string, brotherField: LinkFieldDto) {
    return async (transactionKey: string) => {
      const tableId = brotherField.options.foreignTableId;
      const prisma = this.transactionService.getTransactionSync(transactionKey);
      const field = await this.fieldSupplementService.supplementByCreate(
        prisma,
        brotherFieldTableId,
        brotherField
      );
      await this.fieldSupplementService.createReference(prisma, field);

      const snapshot = this.createField2Ops(tableId, field);
      const id = snapshot.field.id;
      const collection = `${IdPrefix.Field}_${tableId}`;
      const doc = this.shareDbService.getConnection(transactionKey).get(collection, id);
      return await new Promise<IFieldSnapshot>((resolve, reject) => {
        doc.create(snapshot, (error) => {
          if (error) return reject(error);
          // console.log(`create document ${collectionId}.${id} succeed!`);
          resolve(doc.data);
        });
      });
    };
  }

  createCreators(tableId: string, field: IFieldInstance) {
    const creators: ((transactionKey: string) => Promise<IFieldSnapshot>)[] = [];
    const { creator, snapshot } = this.generateFirstCreators(tableId, field);
    creators.push(creator);
    if (field.type === FieldType.Link) {
      creators.push(this.generateSecondCreators(tableId, field));
    }
    return {
      creators,
      opMeta: snapshot.field,
    };
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

        const updateKeys = (Object.keys(updateFieldRo) as (keyof UpdateFieldRo)[]).filter(
          (key) => oldFieldInstance[key] !== newFieldInstance[key]
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
