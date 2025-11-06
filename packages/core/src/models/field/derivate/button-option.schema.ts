import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { Colors } from '../colors';

export const buttonFieldOptionsSchema = z.object({
  label: z.string().meta({ description: 'Button label' }),
  color: z.enum(Colors).meta({ description: 'Button color' }),
  maxCount: z.number().optional().meta({ description: 'Max count of button clicks' }),
  resetCount: z.boolean().optional().meta({ description: 'Reset count' }),
  workflow: z
    .object({
      id: z.string().startsWith(IdPrefix.Workflow).optional().meta({ description: 'Workflow ID' }),
      name: z.string().optional().meta({ description: 'Workflow Name' }),
      isActive: z.boolean().optional().meta({ description: 'Workflow is active' }),
    })
    .optional()
    .nullable()
    .meta({ description: 'Workflow' }),
});

export type IButtonFieldOptions = z.infer<typeof buttonFieldOptionsSchema>;
