import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { FieldType, CellValueType } from '../constant';
import { FieldCore } from '../field';

export const attachmentFieldOptionsSchema = z.object({});

export type IAttachmentOptions = z.infer<typeof attachmentFieldOptionsSchema>;

export const attachmentItemSchema = z.object({
  id: z.string().startsWith(IdPrefix.Attachment),
  name: z.string(),
  token: z.string(),
  size: z.number(),
  mimetype: z.string(),
  path: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export type IAttachmentItem = z.infer<typeof attachmentItemSchema>;

export const attachmentCellValueSchema = z.array(attachmentItemSchema).nonempty();

export type IAttachmentCellValue = z.infer<typeof attachmentCellValueSchema>;

export class AttachmentFieldCore extends FieldCore {
  type: FieldType.Attachment = FieldType.Attachment;

  options!: IAttachmentOptions;

  cellValueType = CellValueType.String;

  isMultipleCellValue = true;

  isComputed = false;

  cellValue2String(cellValue?: IAttachmentCellValue) {
    return cellValue ? cellValue.map((cv) => cv.name).join(', ') : '';
  }

  convertStringToCellValue(_value: string) {
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
    return attachmentCellValueSchema.nullable().safeParse(cellValue);
  }
}
