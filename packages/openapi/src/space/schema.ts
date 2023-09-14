import { z } from '../zod';

export const createSpaceRoSchema = z.object({
  name: z.string().optional(),
});

export type ICreateSpaceRo = z.infer<typeof createSpaceRoSchema>;

export const createSpaceVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type ICreateSpaceVo = z.infer<typeof createSpaceVoSchema>;

export const updateSpaceRoSchema = createSpaceRoSchema;

export type IUpdateSpaceRo = z.infer<typeof createSpaceRoSchema>;

export const updateSpaceVoSchema = createSpaceVoSchema;

export type IUpdateSpaceVo = z.infer<typeof updateSpaceVoSchema>;

export const getSpaceVoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type IGetSpaceVo = z.infer<typeof getSpaceVoSchema>;
