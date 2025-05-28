import { z } from './zod';

export const getListSchemaVo = <T>(item: z.ZodType<T>) => {
  return z.object({
    total: z.number(),
    list: z.array(item),
  });
};
