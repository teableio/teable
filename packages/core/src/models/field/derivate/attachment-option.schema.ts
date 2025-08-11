import { z } from '../../../zod';

export const attachmentFieldOptionsSchema = z.object({}).strict();

export type IAttachmentFieldOptions = z.infer<typeof attachmentFieldOptionsSchema>;
