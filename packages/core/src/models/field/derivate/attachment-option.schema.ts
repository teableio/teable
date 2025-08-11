import { z } from '../../../zod';

// Attachment field options
export const attachmentFieldOptionsSchema = z.object({}).strict();

export type IAttachmentFieldOptions = z.infer<typeof attachmentFieldOptionsSchema>;
