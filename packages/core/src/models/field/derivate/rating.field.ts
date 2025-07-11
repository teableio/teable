import { z } from 'zod';
import { Colors } from '../colors';
import type { CellValueType, FieldType } from '../constant';
import { FieldCore } from '../field';
import { parseStringToNumber } from '../formatting';

export enum RatingIcon {
  Star = 'star',
  Moon = 'moon',
  Sun = 'sun',
  Zap = 'zap',
  Flame = 'flame',
  Heart = 'heart',
  Apple = 'apple',
  ThumbUp = 'thumb-up',
}

export const RATING_ICON_COLORS = [
  Colors.YellowBright,
  Colors.RedBright,
  Colors.TealBright,
] as const;

export const ratingColorsSchema = z.enum(RATING_ICON_COLORS);

export type IRatingColors = z.infer<typeof ratingColorsSchema>;

export const ratingFieldOptionsSchema = z
  .object({
    icon: z.nativeEnum(RatingIcon),
    color: ratingColorsSchema,
    max: z.number().int().max(10).min(1),
  })
  .describe('options for rating field');

export type IRatingFieldOptions = z.infer<typeof ratingFieldOptionsSchema>;

export class RatingFieldCore extends FieldCore {
  type!: FieldType.Rating;

  options!: IRatingFieldOptions;

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
    return num == null ? null : Math.min(Math.round(num), this.options.max);
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (typeof value === 'number') {
      return Math.min(Math.round(value), this.options.max);
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
        .array(z.number().int().max(this.options.max).min(1))
        .nonempty()
        .nullable()
        .safeParse(value);
    }
    return z.number().int().max(this.options.max).min(1).nullable().safeParse(value);
  }
}
