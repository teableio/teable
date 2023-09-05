import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export * from './generate.schema';
export { AttachmentPath, AttachmentSchema } from './attachment';
export { RecordPath, RecordSchema } from './record';
export { SelectionSchema, SelectionPath } from './selection';
export { AuthSchema, AuthPath } from './auth';
