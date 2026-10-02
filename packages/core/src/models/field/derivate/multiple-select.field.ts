import { z } from 'zod';
import type { FieldType, CellValueType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { SelectFieldCore } from './abstract/select.field.abstract';

export const multipleSelectCelValueSchema = z.array(z.string());

export type IMultipleSelectCellValue = z.infer<typeof multipleSelectCelValueSchema>;

/**
 * Splits on newlines and commas that are not inside double quotes, dropping one optional
 * whitespace character after each separator. Same result as the former
 * `/[\n\r,]\s?(?=(?:[^"]*"[^"]*")*[^"]*$)/` split, but in a single linear pass.
 */
function splitOutsideQuotes(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && (char === ',' || char === '\n' || char === '\r')) {
      parts.push(current);
      current = '';
      if (/\s/.test(value[i + 1] ?? '')) i++;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

export class MultipleSelectFieldCore extends SelectFieldCore {
  type!: FieldType.MultipleSelect;

  cellValueType!: CellValueType.String;

  isMultipleCellValue = true;

  convertStringToCellValue(value: string, shouldExtend?: boolean): string[] | null {
    if (value == null) {
      return null;
    }

    let cellValue = splitOutsideQuotes(value).map((item) => {
      return item.includes(',') ? item.slice(1, -1).trim() : item.trim();
    });

    cellValue = shouldExtend
      ? cellValue
      : cellValue.filter((value) => this.options.choices.find((c) => c.name === value));

    return cellValue.length === 0 ? null : cellValue;
  }

  repair(value: unknown) {
    if (Array.isArray(value)) {
      const cellValue = value.filter((value) => this.options.choices.find((c) => c.name === value));

      if (cellValue.length === 0) {
        return null;
      }
      return cellValue;
    }

    if (typeof value === 'string') {
      return this.convertStringToCellValue(value);
    }

    throw new Error(`invalid value: ${value} for field: ${this.name}`);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitMultipleSelectField(this);
  }
}
