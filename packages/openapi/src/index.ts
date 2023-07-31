import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export * from './generate.schema';
export { AttachmentPath, AttachmentSchema, AttachmentApi } from './attachment';
export { RecordPath, RecordSchema, RecordApi } from './record';
export { CopyAndPasteSchema, CopyAndPasteApi, CopyAndPastePath } from './copyAndPaste';
