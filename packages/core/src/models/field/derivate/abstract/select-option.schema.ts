import { z } from '../../../../zod';

// Select field options (for single and multiple select)
export const selectFieldChoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export const selectFieldChoiceRoSchema = selectFieldChoiceSchema.partial({ id: true, color: true });

export type ISelectFieldChoice = z.infer<typeof selectFieldChoiceSchema>;

export const selectFieldOptionsSchema = z.object({
  choices: z.array(selectFieldChoiceSchema),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
  preventAutoNewOptions: z.boolean().optional(),
});

export const selectFieldOptionsRoSchema = z.object({
  choices: z.array(selectFieldChoiceRoSchema),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
  preventAutoNewOptions: z.boolean().optional(),
});

export type ISelectFieldOptions = z.infer<typeof selectFieldOptionsSchema>;
export type ISelectFieldOptionsRo = z.infer<typeof selectFieldOptionsRoSchema>;
