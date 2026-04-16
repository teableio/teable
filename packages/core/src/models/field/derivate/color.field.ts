import { z } from 'zod';
import type { CellValueType, FieldType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import type { IColorFieldOptions } from './color-option.schema';
import { colorFieldOptionsSchema } from './color-option.schema';

const colorRegex = /^#[0-9a-f]{6}$/i;

const colorCellValueSchema = z.string().regex(colorRegex);

export class ColorFieldCore extends FieldCore {
  type!: FieldType.Color;

  options!: IColorFieldOptions;

  meta?: undefined;

  cellValueType!: CellValueType.String;

  static defaultOptions(): IColorFieldOptions {
    return {};
  }

  cellValue2String(cellValue?: unknown): string {
    if (this.isMultipleCellValue && Array.isArray(cellValue)) {
      return cellValue.join(', ');
    }
    return (cellValue as string) ?? '';
  }

  item2String(value?: unknown): string {
    return (value as string) ?? '';
  }

  convertStringToCellValue(value: string): string | null {
    if (this.isLookup) return null;
    const v = value?.trim().toUpperCase() ?? null;
    if (!v || !colorRegex.test(v)) return null;
    return v;
  }

  repair(value: unknown): string | null {
    if (typeof value === 'string') return this.convertStringToCellValue(value);
    return null;
  }

  validateOptions() {
    return colorFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(colorCellValueSchema).nonempty().nullable().safeParse(value);
    }
    return colorCellValueSchema.nullable().safeParse(value);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitColorField(this);
  }
}
