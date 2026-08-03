import { z } from '../../../zod';

// Created by field options
export const createdByFieldOptionsSchema = z.object({}).strict();

export type ICreatedByFieldOptions = z.infer<typeof createdByFieldOptionsSchema>;
