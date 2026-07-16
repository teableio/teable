import { z } from '../../../zod';

export const colorFieldOptionsSchema = z.object({});

export type IColorFieldOptions = z.infer<typeof colorFieldOptionsSchema>;
