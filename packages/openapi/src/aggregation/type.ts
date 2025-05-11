import { z } from 'zod';

export enum GroupPointType {
  Header = 0,
  Row = 1,
}

const groupHeaderPointSchema = z.object({
  id: z.string(),
  type: z.literal(GroupPointType.Header),
  depth: z.number().max(2).min(0),
  value: z.unknown(),
  isCollapsed: z.boolean(),
});

const groupRowPointSchema = z.object({
  type: z.literal(GroupPointType.Row),
  count: z.number(),
});

export const groupHeaderRefSchema = z.object({
  id: z.string(),
  depth: z.number().max(2).min(0),
});

const groupPointSchema = z.union([groupHeaderPointSchema, groupRowPointSchema]);

export type IGroupHeaderPoint = z.infer<typeof groupHeaderPointSchema>;

export type IGroupHeaderRef = z.infer<typeof groupHeaderRefSchema>;

export type IGroupPoint = z.infer<typeof groupPointSchema>;

export const groupPointsVoSchema = groupPointSchema.array().nullable();

export type IGroupPointsVo = z.infer<typeof groupPointsVoSchema>;
