import { z } from '../zod';

export const createBaseRoSchema = z.object({
  spaceId: z.string(),
  name: z.string().optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
});

export type ICreateBaseRo = z.infer<typeof createBaseRoSchema>;

export const createBaseVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  order: z.number(),
});

export type ICreateBaseVo = z.infer<typeof createBaseVoSchema>;

export const updateBaseRoSchema = createBaseRoSchema;

export type IUpdateBaseRo = z.infer<typeof createBaseRoSchema>;

export const updateBaseVoSchema = z.object({
  spaceId: z.string().optional(),
  name: z.string().optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
});

export type IUpdateBaseVo = z.infer<typeof updateBaseVoSchema>;

export const getBaseVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  order: z.number(),
  icon: z.string().nullable(),
});

export type IGetBaseVo = z.infer<typeof getBaseVoSchema>;

export const getBaseListRoSchema = z.object({
  spaceId: z.string().optional(),
});

export type IGetBasesListRo = z.infer<typeof getBaseListRoSchema>;
