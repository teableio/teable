import { z } from 'zod';

export const viewTypeSchema = z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']);

export const viewInputSchema = z.object({
  type: viewTypeSchema.optional(),
  name: z.string().optional(),
});

export type IViewInput = z.output<typeof viewInputSchema>;
