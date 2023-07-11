import { z } from 'zod';

export const numberFormattingSchema = z.object({
  precision: z.number().max(5).min(0),
});

export type INumberFormatting = z.infer<typeof numberFormattingSchema>;
