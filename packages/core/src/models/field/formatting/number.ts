import { z } from 'zod';

export const numberFormattingDef = z.object({
  precision: z.number().max(5).min(0),
});

export type INumberFormatting = z.infer<typeof numberFormattingDef>;
