import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { Colors } from '../colors';

export const buttonFieldOptionsSchema = z.object({
  label: z.string().openapi({ description: 'Button label' }),
  color: z.nativeEnum(Colors).openapi({ description: 'Button color' }),
  maxCount: z.number().optional().openapi({ description: 'Max count of button clicks' }),
  resetCount: z.boolean().optional().openapi({ description: 'Reset count' }),
  action: z
    .enum(['workflow', 'openLink'])
    .default('workflow')
    .openapi({ description: 'Button action type' }),
  url: z.string().optional().openapi({
    description:
      'URL to open when action is openLink (can be a hardcoded URL or field reference like {fieldId}',
  }),
  openInNewTab: z
    .boolean()
    .default(true)
    .optional()
    .openapi({ description: 'Open URL in new tab' }),
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
