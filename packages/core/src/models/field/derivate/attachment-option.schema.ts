import { z } from '../../../zod';
import { FieldType } from '../constant';

export const attachmentFieldOptionsSchema = z
  .object({
    isPublic: z.boolean().optional().meta({
      description: 'Give every file in this field a public link that anyone can open',
    }),
  })
  .strict();

export type IAttachmentFieldOptions = z.infer<typeof attachmentFieldOptionsSchema>;

/**
 * Templates and .tea exports leave the owner's hands, so their attachment fields start
 * private: whoever uses them has not agreed to publish the files. Lookups mirror the
 * options of their attachment field, so they are cleared too.
 */
export const omitAttachmentPublic = <T extends { type: string; options?: unknown }>(
  field: T
): T => {
  const options = field.options as IAttachmentFieldOptions | null | undefined;
  if (field.type !== FieldType.Attachment || !options || !('isPublic' in options)) {
    return field;
  }
  const { isPublic: _isPublic, ...rest } = options;
  return { ...field, options: rest };
};
