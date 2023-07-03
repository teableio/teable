import { z } from 'zod';

export const and = z.literal('and');
export const or = z.literal('or');

export const conjunction = z.union([and, or]);
export type IConjunction = z.infer<typeof conjunction>;
