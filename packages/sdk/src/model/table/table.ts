/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IRecord, IUpdateFieldRo, IViewRo, TableAction } from '@teable/core';
import { FieldKeyType, TableCore } from '@teable/core';
import type { IUpdateOrderRo, IRecordInsertOrderRo, ITableVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createRecords,
  createView,
  deleteField,
  deleteView,
  getAggregation,
  getRowCount,
  getViewList,
  updateDbTableName,
  updateField,
  updateTableDescription,
  updateTableIcon,
  updateTableName,
  updateTableOrder,
} from '@teable/openapi';
import type { Doc } from 'sharedb/lib/client';
import { requestWrap } from '../../utils/requestWrap';

export class Table extends TableCore {
  static getAggregations = requestWrap(getAggregation);

  static getRowCount = requestWrap(getRowCount);

  protected doc!: Doc<ITableVo>;

  baseId!: string;

  permission?: { [key in TableAction]: boolean };

  async getViews() {
    return getViewList(this.id);
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
    return createView(this.id, viewRo);
  }

  async deleteView(viewId: string) {
    return deleteView(this.id, viewId);
  }

  async createRecord(recordFields: IRecord['fields'], recordOrder?: IRecordInsertOrderRo) {
    return createRecords(this.id, {
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
    return createField(this.id, fieldRo);
  }

  async updateField(fieldId: string, fieldRo: IUpdateFieldRo) {
    return updateField(this.id, fieldId, fieldRo);
  }

  async convertField(fieldId: string, fieldRo: IFieldRo) {
    return convertField(this.id, fieldId, fieldRo);
  }

  async deleteField(fieldId: string) {
    return deleteField(this.id, fieldId);
  }
}
