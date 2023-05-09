/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import {
  formatFieldErrorMessage,
  generateTransactionKey,
  IdPrefix,
  OpBuilder,
} from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import { isEmpty, isString } from 'lodash';
import { ShareDbService } from '../../../share-db/share-db.service';
import { FieldService } from '../field.service';
import type { IFieldInstance } from '../model/factory';
import { createFieldInstanceByVo } from '../model/factory';
import type { UpdateFieldRo } from '../model/update-field.ro';

@Injectable()
export class FieldOpenApiService {
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly fieldService: FieldService
  ) {}

  async createField(
    tableId: string,
    fieldInstance: IFieldInstance,
    transactionMeta?: { transactionKey: string; opCount: number }
  ) {
    const snapshot = await this.createField2Ops(tableId, fieldInstance);
    const id = snapshot.field.id;
    const collection = `${IdPrefix.Field}_${tableId}`;
    const doc = this.shareDbService.connect().get(collection, id);
    return new Promise<Doc>((resolve, reject) => {
      doc.create(snapshot, undefined, transactionMeta, (error) => {
        if (error) return reject(error);
        // console.log(`create document ${collectionId}.${id} succeed!`);
        resolve(doc);
      });
    });
  }

  async createField2Ops(_tableId: string, fieldInstance: IFieldInstance) {
    return OpBuilder.creator.addField.build({
      ...fieldInstance,
    });
  }

  async updateFieldById(tableId: string, fieldId: string, updateFieldRo: UpdateFieldRo) {
    const fieldVo = await this.fieldService.getField(tableId, fieldId);
    if (!fieldVo) {
      throw new HttpException(`Not found fieldId(${fieldId})`, HttpStatus.NOT_FOUND);
    }

    const oldFieldInstance = createFieldInstanceByVo(fieldVo);

    const newFieldInstance = createFieldInstanceByVo({
      ...fieldVo,
      ...updateFieldRo,
    });

    const validateKeys = ['name', 'description', 'type', 'options', 'defaultValue'];

    const updateKeys = (Object.keys(updateFieldRo) as (keyof UpdateFieldRo)[]).filter(
      (key) => oldFieldInstance[key] !== newFieldInstance[key]
    );

    const validateErrors = validateKeys
      .map((key) => this.validateUpdateField(key, newFieldInstance))
      .map((res) => res.error)
      .filter(isString);

    if (validateErrors.length > 0) {
      throw new HttpException(validateErrors[0], HttpStatus.BAD_REQUEST);
    }

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

  private validateUpdateField(key: string, fieldInstance: IFieldInstance) {
    switch (key) {
      case 'name':
      case 'description':
      case 'type':
        return { success: true };
      case 'defaultValue': {
        const res = fieldInstance.validateDefaultValue();
        return {
          success: res.success,
          error: res.success ? null : formatFieldErrorMessage(res.error),
        };
      }
      case 'options': {
        const res = fieldInstance.validateOptions();
        return {
          success: res.success,
          error: res.success ? null : formatFieldErrorMessage(res.error),
        };
      }
      default:
        return {
          success: false,
          error: 'The name field in the field does not support checksum',
        };
    }
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
