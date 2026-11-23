import { z } from 'zod';

/** GET query values arrive as strings; retain the same decoded command input. */
export const jsonQuerySchema = <TSchema extends z.ZodType>(schema: TSchema) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, schema);

export const booleanQuerySchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);
