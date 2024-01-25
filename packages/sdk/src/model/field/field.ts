/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IFieldVo, IUpdateFieldRo } from '@teable-group/core';
import { FieldCore } from '@teable-group/core';
import {
  createField,
  deleteField,
  getFields,
  convertField,
  updateField,
} from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';

export abstract class Field extends FieldCore {
  tableId!: string;

  static getFields = requestWrap(getFields);

  static createField = requestWrap(createField);

  static updateField = requestWrap(updateField);

  static convertField = requestWrap(convertField);

  static deleteField = requestWrap(deleteField);

  protected doc!: Doc<IFieldVo>;

  async update(updateFieldRo: IUpdateFieldRo) {
    return Field.updateField(this.tableId, this.id, updateFieldRo);
  }

  async convert(fieldRo: IFieldRo) {
    return Field.convertField(this.tableId, this.id, fieldRo);
  }

  async delete() {
    return Field.deleteField(this.tableId, this.id);
  }
}
