/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IRecord, ITableVo, IViewRo } from '@teable-group/core';
import { FieldKeyType, TableCore, TableOpBuilder } from '@teable-group/core';
import {
  createTable,
  deleteTable,
  getAggregation,
  getGroupPoints,
  getRowCount,
  tableSqlQuery,
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

  async getViews() {
    return View.getViews(this.id);
  }

  async updateName(name: string) {
    const fieldOperation = TableOpBuilder.editor.setTableProperty.build({
      key: 'name',
      newValue: name,
      oldValue: this.name,
    });

    try {
      return await new Promise((resolve, reject) => {
        this.doc.submitOp([fieldOperation], undefined, (error) => {
          error ? reject(error) : resolve(undefined);
        });
      });
    } catch (error) {
      return error;
    }
  }

  async updateIcon(icon: string) {
    const tableOperation = TableOpBuilder.editor.setTableProperty.build({
      key: 'icon',
      newValue: icon,
      oldValue: this.icon,
    });

    try {
      return await new Promise((resolve, reject) => {
        this.doc.submitOp([tableOperation], undefined, (error) => {
          error ? reject(error) : resolve(undefined);
        });
      });
    } catch (error) {
      return error;
    }
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

  async updateOrder(order: number) {
    const tableOperation = TableOpBuilder.editor.setTableProperty.build({
      key: 'order',
      newValue: order,
      oldValue: this.order,
    });

    try {
      return await new Promise((resolve, reject) => {
        this.doc.submitOp([tableOperation], undefined, (error) => {
          error ? reject(error) : resolve(undefined);
        });
      });
    } catch (error) {
      return error;
    }
  }
}
