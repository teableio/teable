import { z } from 'zod';
import { Colors } from '../colors';
import type { CellValueType, FieldType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import { parseStringToNumber } from '../formatting';
import type { IRatingFieldOptions } from './rating-option.schema';
import { ratingFieldOptionsSchema, RatingIcon } from './rating-option.schema';

export class RatingFieldCore extends FieldCore {
  type!: FieldType.Rating;

  options!: IRatingFieldOptions;

  meta?: undefined;

  cellValueType!: CellValueType.Number;

  static defaultOptions(): IRatingFieldOptions {
    return {
      icon: RatingIcon.Star,
      color: Colors.YellowBright,
      max: 5,
    };
  }

  cellValue2String(cellValue?: unknown) {
    if (cellValue == null) {
      return '';
    }

    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }

    return this.item2String(cellValue as number);
  }

  item2String(value?: unknown): string {
    if (value == null) {
      return '';
    }
    return String(value);
  }

  convertStringToCellValue(value: string): number | null {
    if (this.isLookup) {
      return null;
    }

    const num = parseStringToNumber(value);
    return num == null ? null : Math.min(Math.round(num), this.options.max ?? 10);
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'number') {
      return Math.min(Math.round(value), this.options.max ?? 10);
    }
    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }
    return null;
  }

  validateOptions() {
    return ratingFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z
        .array(
          z
            .number()
            .int()
            .max(this.options.max ?? 10)
            .min(1)
        )
        .nonempty()
        .nullable()
        .safeParse(value);
    }
    return z
      .number()
      .int()
      .max(this.options.max ?? 10)
      .min(1)
      .nullable()
      .safeParse(value);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitRatingField(this);
  }
}
