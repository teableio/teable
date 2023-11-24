import { z } from 'zod';
import { IdPrefix } from '../../utils';

export const fieldsViewVisibleRoSchema = z.object({
  viewFields: z
    .object({
      fieldId: z.string().startsWith(IdPrefix.Field).length(19),
      hidden: z.boolean(),
    })
    .array()
    .nonempty(),
});

export type IFieldsViewVisibleRo = z.infer<typeof fieldsViewVisibleRoSchema>;
