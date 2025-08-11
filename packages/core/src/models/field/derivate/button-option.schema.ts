import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { Colors } from '../colors';

export const buttonFieldOptionsSchema = z.object({
  label: z.string().openapi({ description: 'Button label' }),
  color: z.nativeEnum(Colors).openapi({ description: 'Button color' }),
  maxCount: z.number().optional().openapi({ description: 'Max count of button clicks' }),
  resetCount: z.boolean().optional().openapi({ description: 'Reset count' }),
  workflow: z
    .object({
      id: z
        .string()
        .startsWith(IdPrefix.Workflow)
        .optional()
        .openapi({ description: 'Workflow ID' }),
      name: z.string().optional().openapi({ description: 'Workflow Name' }),
      isActive: z.boolean().optional().openapi({ description: 'Workflow is active' }),
    })
    .optional()
    .nullable()
    .openapi({ description: 'Workflow' }),
});

export type IButtonFieldOptions = z.infer<typeof buttonFieldOptionsSchema>;
