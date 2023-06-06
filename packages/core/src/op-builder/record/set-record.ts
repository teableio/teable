import { isEqual } from 'lodash';
import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetRecordOpContext {
  name: OpName.SetRecord;
  fieldId: string;
  newValue: unknown;
  oldValue: unknown;
}

export class SetRecordBuilder implements IOpBuilder {
  name: OpName.SetRecord = OpName.SetRecord;

  build(params: { fieldId: string; newCellValue: unknown; oldCellValue: unknown }): IOtOperation {
    const { fieldId } = params;
    let { newCellValue, oldCellValue } = params;
    newCellValue = newCellValue ?? null;
    oldCellValue = oldCellValue ?? null;

    if (isEqual(oldCellValue, newCellValue)) {
      throw new Error(`'old value (${oldCellValue}) and new value (${newCellValue}) are equal'`);
    }

    // convert set null to delete key
    if (newCellValue == null || (Array.isArray(newCellValue) && newCellValue.length === 0)) {
      return {
        p: ['record', 'fields', fieldId],
        od: oldCellValue,
        oi: null,
      };
    }

    // convert new cellValue to insert key
    if (oldCellValue == null) {
      return {
        p: ['record', 'fields', fieldId],
        oi: newCellValue,
      };
    }

    return {
      p: ['record', 'fields', fieldId],
      od: oldCellValue,
      oi: newCellValue,
    };
  }

  detect(op: IOtOperation): ISetRecordOpContext | null {
    const { p, oi, od } = op;
    const result = pathMatcher<{ fieldId: string }>(p, ['record', 'fields', ':fieldId']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      fieldId: result.fieldId,
      newValue: oi,
      oldValue: od,
    };
  }
}
