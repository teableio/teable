import type { IFormulaFieldMeta } from '@teable/core';
import { FormulaFieldCore, CellValueType } from '@teable/core';
import { match, P } from 'ts-pattern';
import type { FieldBase } from '../field-base';

export class FormulaFieldDto extends FormulaFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return false;
  }

  setMetadata(meta: IFormulaFieldMeta) {
    this.meta = meta;
  }

  convertCellValue2DBValue(value: unknown): unknown {
    if (this.isMultipleCellValue) {
      return value == null ? value : JSON.stringify(value);
    }
    if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) {
      return null;
    }
    return value;
  }

  convertDBValue2CellValue(value: unknown): unknown {
    const ctx = {
      isMulti: Boolean(this.isMultipleCellValue),
      isBool: this.cellValueType === CellValueType.Boolean,
      val: value,
    };

    return (
      match(ctx)
        // Multiple-value formulas: JSON already or null -> return as is
        .with(
          { isMulti: true, val: P.when((v) => v == null || typeof v === 'object') },
          ({ val }) => val
        )
        // Multiple-value formulas: stringified JSON -> parse
        .with({ isMulti: true, val: P.string }, ({ val }) => {
          try {
            return JSON.parse(val);
          } catch {
            return val;
          }
        })
        // Multiple-value formulas: any other -> return as is
        .with({ isMulti: true }, ({ val }) => val)
        // Date -> ISO string
        .with({ isMulti: false, val: P.instanceOf(Date) }, ({ val }) => (val as Date).toISOString())
        // BigInt -> number
        .with({ isMulti: false, val: P.when((v) => typeof v === 'bigint') }, ({ val }) =>
          Number(val as bigint)
        )
        // Boolean formulas: number 0/1 -> boolean
        .with(
          { isMulti: false, isBool: true, val: P.when((v) => typeof v === 'number') },
          ({ val }) => (val as number) === 1
        )
        // Boolean formulas: string '0'/'1'/'true'/'false' -> boolean
        .with(
          { isMulti: false, isBool: true, val: P.when((v) => typeof v === 'string') },
          ({ val }) => {
            const s = (val as string).toLowerCase();
            if (s === '1' || s === 'true') return true;
            if (s === '0' || s === 'false') return false;
            return val;
          }
        )
        // Fallback
        .otherwise(({ val }) => val)
    );
  }
}
