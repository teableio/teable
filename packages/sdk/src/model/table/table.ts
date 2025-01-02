/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IRecord, IUpdateFieldRo, IViewRo, TableAction } from '@teable/core';
import { FieldKeyType, TableCore } from '@teable/core';
import type { IUpdateOrderRo, IRecordInsertOrderRo, ITableVo } from '@teable/openapi';
import {
  createTable,
  deleteTable,
  getAggregation,
  getGroupPoints,
  getRowCount,
  updateDbTableName,
  updateTableDescription,
  updateTableIcon,
  updateTableName,
  updateTableOrder,
} from '@teable/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';
import { Field } from '../field/field';
import { Record } from '../record/record';
import { View } from '../view';

export class Table extends TableCore {
  static createTable = requestWrap(createTable);

  static deleteTable = requestWrap(deleteTable);

  static getAggregations = requestWrap(getAggregation);

  static getRowCount = requestWrap(getRowCount);

  static getGroupPoints = requestWrap(getGroupPoints);

  protected doc!: Doc<ITableVo>;

  baseId!: string;

  permission?: { [key in TableAction]: boolean };

  async getViews() {
    return View.getViews(this.id);
  }

  async updateName(name: string) {
    return requestWrap(updateTableName)(this.baseId, this.id, { name });
  }

  async updateDbTableName(dbTableName: string) {
    return requestWrap(updateDbTableName)(this.baseId, this.id, { dbTableName });
  }

  async updateDescription(description: string | null) {
    return requestWrap(updateTableDescription)(this.baseId, this.id, { description });
  }

  async updateIcon(icon: string) {
    return requestWrap(updateTableIcon)(this.baseId, this.id, { icon });
  }

  async updateOrder(orderRo: IUpdateOrderRo) {
    return requestWrap(updateTableOrder)(this.baseId, this.id, orderRo);
  }

  async createView(viewRo: IViewRo) {
    return View.createView(this.id, viewRo);
  }

  async deleteView(viewId: string) {
    return View.deleteView(this.id, viewId);
  }

  async createRecord(recordFields: IRecord['fields'], recordOrder?: IRecordInsertOrderRo) {
    return Record.createRecords(this.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: recordFields,
        },
      ],
      order: recordOrder,
    });
  }

  async createField(fieldRo: IFieldRo) {
    return Field.createField(this.id, fieldRo);
  }

  async updateField(fieldId: string, fieldRo: IUpdateFieldRo) {
    return Field.updateField(this.id, fieldId, fieldRo);
  }

  async convertField(fieldId: string, fieldRo: IFieldRo) {
    return Field.convertField(this.id, fieldId, fieldRo);
  }

  async deleteField(fieldId: string) {
    return Field.deleteField(this.id, fieldId);
  }
}
