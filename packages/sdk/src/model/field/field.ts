/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IFieldVo } from '@teable-group/core';
import { FieldCore } from '@teable-group/core';
import { createField, deleteField, getFields, updateField } from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';

export abstract class Field extends FieldCore {
  tableId!: string;

  static getFields = requestWrap(getFields);

  static createField = requestWrap(createField);

  static updateField = requestWrap(updateField);

  static deleteField = requestWrap(deleteField);

  protected doc!: Doc<IFieldVo>;

  private async submitOperation(operation: unknown) {
    try {
      return await new Promise((resolve, reject) => {
        this.doc.submitOp([operation], undefined, (error) => {
          error ? reject(error) : resolve(undefined);
        });
      });
    } catch (error) {
      return error;
    }
  }

  async update(fieldRo: IFieldRo) {
    return Field.updateField(this.tableId, this.id, fieldRo);
  }

  async delete() {
    return Field.deleteField(this.tableId, this.id);
  }
}
