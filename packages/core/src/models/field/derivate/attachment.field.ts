import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export const attachmentFieldOptionsSchema = z.object({}).strict();

export type IAttachmentFieldOptions = z.infer<typeof attachmentFieldOptionsSchema>;

export const attachmentItemSchema = z.object({
  id: z.string().startsWith(IdPrefix.Attachment),
  name: z.string(),
  token: z.string(),
  size: z.number(),
  mimetype: z.string(),
  path: z.string(),
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export type IAttachmentItem = z.infer<typeof attachmentItemSchema>;

export const attachmentCellValueSchema = z.array(attachmentItemSchema);

export type IAttachmentCellValue = z.infer<typeof attachmentCellValueSchema>;

export class AttachmentFieldCore extends FieldCore {
  type: FieldType.Attachment = FieldType.Attachment;

  options!: IAttachmentFieldOptions;

  cellValueType = CellValueType.String;

  isMultipleCellValue = true;

  isComputed = false;

  static defaultOptions(): IAttachmentFieldOptions {
    return {};
  }

  cellValue2String(cellValue?: IAttachmentCellValue) {
    // TODO: The path is currently empty
    return cellValue ? cellValue.map((cv) => `${cv.name} (${cv.url})`).join(',') : '';
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
    return (value as { name?: string }).name || '';
  }
}
