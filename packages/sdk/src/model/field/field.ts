/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IFieldVo, IUpdateFieldRo } from '@teable/core';
import { FieldCore } from '@teable/core';
import { createField, deleteField, convertField, updateField } from '@teable/openapi';
import type { Doc } from 'sharedb/lib/client';

export abstract class Field extends FieldCore {
  tableId!: string;

  protected doc!: Doc<IFieldVo>;

  get canReadFieldRecord() {
    return this.recordRead !== false;
  }

  get canCreateFieldRecord() {
    return this.recordCreate !== false;
  }

  async create(fieldRo: IFieldRo) {
    return createField(this.tableId, fieldRo);
  }

  async update(updateFieldRo: IUpdateFieldRo) {
    return updateField(this.tableId, this.id, updateFieldRo);
  }

  async convert(fieldRo: IFieldRo) {
    return convertField(this.tableId, this.id, fieldRo);
  }

  async delete() {
    return deleteField(this.tableId, this.id);
  }
}
