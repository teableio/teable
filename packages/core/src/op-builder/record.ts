import { isEqual } from 'lodash';
import type { IOtOperation, IRow } from '../models';
import type { IRecord, IRecordFields } from '../models/record/interface';
import { generateRecordId } from '../utils';

export class RecordOpBuilder {
  static newRecord(): Pick<IRecord, 'id' | 'fields'> {
    return {
      id: generateRecordId(),
      fields: {},
    };
  }

  static setRecord(params: {
    recordId: string;
    fieldId: string;
    newCellValue: unknown;
    oldCellValue: unknown;
  }): IOtOperation | null {
    const { recordId, fieldId } = params;
    let { newCellValue, oldCellValue } = params;
    newCellValue = newCellValue ?? null;
    oldCellValue = oldCellValue ?? null;

    if (isEqual(oldCellValue, newCellValue)) {
      return null;
    }

    // convert set null to delete key
    if (newCellValue == null || (Array.isArray(newCellValue) && newCellValue.length === 0)) {
      return {
        p: ['recordMap', recordId, 'fields', fieldId],
        od: oldCellValue,
      };
    }

    // convert new cellValue to insert key
    if (oldCellValue == null) {
      return {
        p: ['recordMap', recordId, 'fields', fieldId],
        oi: newCellValue,
      };
    }

    return {
      p: ['recordMap', recordId, 'fields', fieldId],
      od: oldCellValue,
      oi: newCellValue,
    };
  }

  static addRecord(record: Pick<IRecord, 'id' | 'fields'>): IOtOperation[] {
    const ops: IOtOperation[] = [];

    for (const fieldId in record.fields) {
      const cellValue = record.fields[fieldId];
      const setCellValueOp = this.setRecord({
        recordId: record.id,
        fieldId,
        newCellValue: cellValue,
        oldCellValue: null,
      });

      setCellValueOp && ops.push(setCellValueOp);
    }

    ops.push({
      p: ['recordMap', record.id],
      oi: record,
    });

    return ops;
  }

  static deleteRecord(params: {
    recordId: string;
    oldRecord: { id: string; fields?: IRecordFields };
  }): IOtOperation[] {
    const { recordId, oldRecord } = params;
    const actions: IOtOperation[] = [];

    // reset record fields
    for (const fieldId in oldRecord.fields) {
      const cellValue = oldRecord.fields[fieldId] ?? null;
      const setRecordAction = this.setRecord({
        recordId,
        fieldId,
        newCellValue: null,
        oldCellValue: cellValue,
      });

      setRecordAction && actions.push(setRecordAction);
    }

    /**
     * remove record itself
     * because record.fields has been reset by step 2, we can assume it is empty
     */
    actions.push({
      p: ['recordMap', recordId],
      od: {
        ...oldRecord,
        fields: {},
      } as IRecord,
    });

    return actions;
  }

  static addRow(params: { recordId: string; viewIndex: number; rowIndex: number }): IOtOperation {
    const { recordId, viewIndex, rowIndex } = params;
    return {
      p: ['meta', 'views', viewIndex, 'rows', rowIndex],
      li: { recordId },
    };
  }

  static deleteRow(params: { viewId: string; rowIndex: number; oldRow: IRow }): IOtOperation {
    const { viewId, rowIndex, oldRow } = params;
    return {
      p: ['viewMap', viewId, 'rows', rowIndex],
      ld: oldRow,
    };
  }
}
