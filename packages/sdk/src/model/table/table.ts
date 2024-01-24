/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IRecord, ITableVo, IViewRo } from '@teable-group/core';
import { FieldKeyType, TableCore } from '@teable-group/core';
import {
  createTable,
  deleteTable,
  getAggregation,
  getGroupPoints,
  getRowCount,
  tableSqlQuery,
  updateDbTableName,
  updateTableDescription,
  updateTableIcon,
  updateTableName,
  updateTableOrder,
} from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';
import { Field } from '../field/field';
import { Record } from '../record/record';
import { View } from '../view';

export class Table extends TableCore {
  static createTable = requestWrap(createTable);

  static deleteTable = requestWrap(deleteTable);

  static sqlQuery = requestWrap(tableSqlQuery);

  static getAggregations = requestWrap(getAggregation);

  static getRowCount = requestWrap(getRowCount);

  static getGroupPoints = requestWrap(getGroupPoints);

  protected doc!: Doc<ITableVo>;

  baseId!: string;

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

  async updateOrder(order: number) {
    return requestWrap(updateTableOrder)(this.baseId, this.id, { order });
  }

  async createView(viewRo: IViewRo) {
    return View.createView(this.id, viewRo);
  }

  async deleteView(viewId: string) {
    return View.deleteView(this.id, viewId);
  }

  async createRecord(recordFields: IRecord['fields'], recordOrder?: { [viewId: string]: number }) {
    return Record.createRecords(this.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: recordFields,
          recordOrder,
        },
      ],
    });
  }

  async createField(fieldRo: IFieldRo) {
    return Field.createField(this.id, fieldRo);
  }

  async updateField(fieldId: string, fieldRo: IFieldRo) {
    return Field.updateField(this.id, fieldId, fieldRo);
  }

  async deleteField(fieldId: string) {
    return Field.deleteField(this.id, fieldId);
  }
}
