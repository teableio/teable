import { IdPrefix } from '../../../utils';
import { z } from '../../../zod';
import type { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';
import type { IFieldVisitor } from '../field-visitor.interface';
import {
  linkFieldOptionsSchema,
  type ILinkFieldOptions,
  type ILinkFieldMeta,
} from './link-option.schema';

export const linkCellValueSchema = z.object({
  id: z.string().startsWith(IdPrefix.Record),
  title: z.string().optional(),
});

export type ILinkCellValue = z.infer<typeof linkCellValueSchema>;

export class LinkFieldCore extends FieldCore {
  static defaultOptions(): Partial<ILinkFieldOptions> {
    return {};
  }

  type!: FieldType.Link;

  options!: ILinkFieldOptions;

  declare meta?: ILinkFieldMeta;

  cellValueType!: CellValueType.String;

  declare isMultipleCellValue?: boolean | undefined;

  getHasOrderColumn(): boolean {
    return this.meta?.hasOrderColumn || false;
  }

  cellValue2String(cellValue?: unknown) {
    if (Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }
    return this.item2String(cellValue);
  }

  convertStringToCellValue(_value: string): string[] | null {
    return null;
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (this.validateCellValue(value).success) {
      return value;
    }
    return null;
  }

  validateOptions() {
    return linkFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(value: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(linkCellValueSchema).nonempty().nullable().safeParse(value);
    }

    return linkCellValueSchema.nullable().safeParse(value);
  }

  item2String(value: unknown) {
    if (value == null) {
      return '';
    }
    return (value as { title?: string }).title || '';
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitLinkField(this);
  }
}
