import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { ViewType } from './constant';

export const viewVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.View),
  name: z.string(),
  type: z.nativeEnum(ViewType),
  description: z.string().optional(),
  order: z.number(),
  options: z.unknown().optional(),
  sort: z.unknown().optional(),
  filter: z.unknown().optional(),
  group: z.unknown().optional(),
});

export type IViewVo = z.infer<typeof viewVoSchema>;

export const viewRoSchema = viewVoSchema
  .omit({
    id: true,
  })
  .partial({
    name: true,
    order: true,
  });

export type IViewRo = z.infer<typeof viewRoSchema>;
