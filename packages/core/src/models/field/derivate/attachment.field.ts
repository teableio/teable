import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export const attachmentFieldOptionsSchema = z.object({}).strict();

export type IAttachmentFieldOptions = z.infer<typeof attachmentFieldOptionsSchema>;

export const attachmentItemSchema = z.object({
  id: z.string().startsWith(IdPrefix.Attachment),
  name: z.string(),
  path: z.string(),
  token: z.string(),
  size: z.number(),
  mimetype: z.string(),
  presignedUrl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  smThumbnailUrl: z.string().optional(),
  lgThumbnailUrl: z.string().optional(),
});

export type IAttachmentItem = z.infer<typeof attachmentItemSchema>;

export const attachmentCellValueSchema = z.array(attachmentItemSchema);

export type IAttachmentCellValue = z.infer<typeof attachmentCellValueSchema>;

export class AttachmentFieldCore extends FieldCore {
  type: FieldType.Attachment = FieldType.Attachment;

  options!: IAttachmentFieldOptions;

  cellValueType = CellValueType.String;

  isMultipleCellValue = true;

  static CELL_VALUE_STRING_SPLITTER = ',';

  static defaultOptions(): IAttachmentFieldOptions {
    return {};
  }

  static itemString(name: string, token: string) {
    return `${name} (${token})`;
  }

  cellValue2String(cellValue?: unknown) {
    // TODO: The path is currently empty
    return cellValue
      ? (cellValue as IAttachmentCellValue)
          .map(this.item2String)
          .join(AttachmentFieldCore.CELL_VALUE_STRING_SPLITTER)
      : '';
  }

  convertStringToCellValue(_value: string, _ctx?: unknown): IAttachmentCellValue | null {
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
    return attachmentFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(cellValue: unknown) {
    return attachmentCellValueSchema.nonempty().nullable().safeParse(cellValue);
  }

  item2String(value: unknown) {
    if (value == null) {
      return '';
    }
    const { name, token } = value as IAttachmentItem;
    return AttachmentFieldCore.itemString(name, token);
  }
}
