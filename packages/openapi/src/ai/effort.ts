import { z } from '../zod';

export const EFFORT_LEVEL_VALUES = ['low', 'medium', 'high', 'xhigh'] as const;
export const effortLevelSchema = z.enum(EFFORT_LEVEL_VALUES);
export type IEffortLevel = z.infer<typeof effortLevelSchema>;
export const DEFAULT_EFFORT_LEVEL: IEffortLevel = 'medium';
