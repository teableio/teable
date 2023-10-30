/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldRo, IRecord, ITableVo, IViewRo } from '@teable-group/core';
import { TableOpBuilder, FieldKeyType, TableCore } from '@teable-group/core';
import { createTable, deleteTable, tableSqlQuery } from '@teable-group/openapi';
import type { Doc } from 'sharedb/lib/client';
import { Field } from '../field/field';
import { Record } from '../record/record';
import { View } from '../view';

export class Table extends TableCore {
  static createTable = createTable;

  static deleteTable = deleteTable;

  static sqlQuery = tableSqlQuery;

  protected doc!: Doc<ITableVo>;

  async getViews() {
    return View.getViews(this.id);
  }

  async updateName(name: string) {
    const fieldOperation = TableOpBuilder.editor.setTableName.build({
      newName: name,
      oldName: this.name,
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
    const tableOperation = TableOpBuilder.editor.setTableIcon.build({
      newIcon: icon,
      oldIcon: this.icon,
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

  async createRecord(recordFields: IRecord['fields']) {
    return Record.createRecords(this.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        {
          fields: recordFields,
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
    const fieldOperation = TableOpBuilder.editor.setTableOrder.build({
      newOrder: order,
      oldOrder: this.order,
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
}
