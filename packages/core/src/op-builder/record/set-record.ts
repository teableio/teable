import { isEqual } from 'lodash';
import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetRecordOpContext {
  name: OpName.SetRecord;
  recordId: string;
  fieldId: string;
  newValue: unknown;
  oldValue: unknown;
}

export class SetRecordBuilder implements IOpBuilder {
  name: OpName.SetRecord = OpName.SetRecord;

  build(params: {
    recordId: string;
    fieldId: string;
    newCellValue: unknown;
    oldCellValue: unknown;
  }): IOtOperation {
    const { recordId, fieldId } = params;
    let { newCellValue, oldCellValue } = params;
    newCellValue = newCellValue ?? null;
    oldCellValue = oldCellValue ?? null;

    if (isEqual(oldCellValue, newCellValue)) {
      throw new Error('old value and new value are equal');
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

  detect(op: IOtOperation): ISetRecordOpContext | null {
    const { p, oi, od } = op;
    const result = pathMatcher<{ fieldId: string; recordId: string }>(p, [
      'recordMap',
      ':recordId',
      'fields',
      ':fieldId',
    ]);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      recordId: result.recordId,
      fieldId: result.fieldId,
      newValue: oi,
      oldValue: od,
    };
  }
}
