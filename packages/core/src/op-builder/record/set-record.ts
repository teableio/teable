import type { IOtOperation } from '../../models';
import { OpName, pathMatcher } from '../common';
import type { IOpBuilder } from '../interface';

export interface ISetRecordOpContext {
  name: OpName.SetRecord;
  fieldId: string;
  newCellValue: unknown;
  oldCellValue: unknown;
}

export class SetRecordBuilder implements IOpBuilder {
  name: OpName.SetRecord = OpName.SetRecord;

  build(params: { fieldId: string; newCellValue: unknown; oldCellValue: unknown }): IOtOperation {
    const { fieldId } = params;
    let { newCellValue, oldCellValue } = params;
    newCellValue = newCellValue ?? null;
    oldCellValue = oldCellValue ?? null;

    // convert set null to delete key
    if (newCellValue == null || (Array.isArray(newCellValue) && newCellValue.length === 0)) {
      return {
        p: ['fields', fieldId],
        od: oldCellValue,
        oi: null,
      };
    }

    // convert new cellValue to insert key
    if (oldCellValue == null) {
      return {
        p: ['fields', fieldId],
        oi: newCellValue,
      };
    }

    return {
      p: ['fields', fieldId],
      od: oldCellValue,
      oi: newCellValue,
    };
  }

  detect(op: IOtOperation): ISetRecordOpContext | null {
    const { p, oi, od } = op;
    const result = pathMatcher<{ fieldId: string }>(p, ['fields', ':fieldId']);

    if (!result) {
      return null;
    }

    return {
      name: this.name,
      fieldId: result.fieldId,
      newCellValue: oi,
      oldCellValue: od,
    };
  }
}
