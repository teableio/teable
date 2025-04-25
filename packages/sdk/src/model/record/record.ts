/* eslint-disable @typescript-eslint/naming-convention */
import type { IRecord } from '@teable/core';
import { RecordCore, FieldKeyType, RecordOpBuilder, FieldType } from '@teable/core';
import { updateRecord } from '@teable/openapi';
import { toast } from '@teable/ui-lib/src/shadcn/ui/sonner';
import { isEqual, isEmpty } from 'lodash';
import type { Doc } from 'sharedb/lib/client';
import { getHttpErrorMessage } from '../../context';
import type { ILocaleFunction } from '../../context/app/i18n';
import type { IFieldInstance } from '../field/factory';

export class Record extends RecordCore {
  private _title?: {
    value?: string;
  };

  constructor(
    protected doc: Doc<IRecord>,
    protected fieldMap: { [fieldId: string]: IFieldInstance }
  ) {
    super(fieldMap);
  }

  get title() {
    if (!this.fieldMap) {
      return undefined;
    }
    if (!this._title) {
      const primaryFieldId = Object.values(this.fieldMap).find((field) => field.isPrimary)?.id;
      const primaryField = primaryFieldId ? this.fieldMap[primaryFieldId] : undefined;
      if (!primaryFieldId || !primaryField) {
        return undefined;
      }
      this._title = {
        value: primaryField.cellValue2String(this.fields[primaryFieldId]),
      };
    }
    return this._title.value;
  }

  static isLocked(permissions: Record['permissions'], fieldId: string) {
    if (!isEmpty(permissions)) {
      return !permissions?.update?.[fieldId];
    }
    return false;
  }

  static isHidden(permissions: Record['permissions'], fieldId: string) {
    if (!isEmpty(permissions)) {
      return !permissions?.read?.[fieldId];
    }
    return false;
  }

  isLocked(fieldId: string) {
    return Record.isLocked(this.permissions, fieldId);
  }

  isHidden(fieldId: string) {
    return Record.isHidden(this.permissions, fieldId);
  }

  private onCommitLocal(fieldId: string, cellValue: unknown, undo?: boolean) {
    const oldCellValue = this.fields[fieldId];
    const operation = RecordOpBuilder.editor.setRecord.build({
      fieldId,
      newCellValue: cellValue,
      oldCellValue,
    });
    this.doc.data.fields[fieldId] = cellValue;
    this.doc.emit('op batch', [operation], false);
    if (this.doc.version) {
      undo ? this.doc.version-- : this.doc.version++;
    }
    this.fields[fieldId] = cellValue;
  }

  private updateComputedField = async (fieldIds: string[], record: IRecord) => {
    const changeCellFieldIds = fieldIds.filter(
      (fieldId) => !isEqual(this.fields[fieldId], record.fields[fieldId])
    );
    if (!changeCellFieldIds.length) {
      return;
    }
    changeCellFieldIds.forEach((fieldId) => {
      this.doc.data.fields[fieldId] = record.fields[fieldId];
    });
    this.doc.emit('op batch', [], false);
  };

  async updateCell(
    fieldId: string,
    cellValue: unknown,
    localization?: { t: ILocaleFunction; prefix?: string }
  ) {
    const oldCellValue = this.fields[fieldId];
    try {
      this.onCommitLocal(fieldId, cellValue);
      this.fields[fieldId] = cellValue;
      const [, tableId] = this.doc.collection.split('_');
      const res = await updateRecord(tableId, this.doc.id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            // you have to set null to clear the value
            [fieldId]: cellValue === undefined ? null : cellValue,
          },
        },
      });
      const computedField = Object.keys(this.fieldMap).filter(
        (fieldId) =>
          this.fieldMap[fieldId].type === FieldType.Link || this.fieldMap[fieldId].isComputed
      );
      if (computedField.length) {
        this.updateComputedField(computedField, res.data);
      }
    } catch (error) {
      this.onCommitLocal(fieldId, oldCellValue, true);

      if (error instanceof Error && localization) {
        toast.error(getHttpErrorMessage(error, localization.t, localization.prefix));
      }

      return error;
    }
  }
}
