import { sharePasswordSchema } from '@teable/core';
import { z } from '../zod';

export const baseShareVoSchema = z.object({
  baseId: z.string(),
  shareId: z.string(),
  password: z.boolean(), // Only indicates if password is set, not the actual value
  nodeId: z.string().nullable(),
  allowSave: z.boolean().nullable(),
  allowCopy: z.boolean().nullable(),
  allowEdit: z.boolean().nullable(),
  enabled: z.boolean(),
});

export type IBaseShareVo = z.infer<typeof baseShareVoSchema>;

// Create only needs nodeId (null = share whole base), settings are configured via update
export const createBaseShareRoSchema = z.object({
  nodeId: z.string().optional(),
});

export type ICreateBaseShareRo = z.infer<typeof createBaseShareRoSchema>;

export const updateBaseShareRoSchema = baseShareVoSchema
  .pick({ allowSave: true, allowCopy: true, allowEdit: true, enabled: true })
  .extend({ password: sharePasswordSchema.nullable().optional() })
  .partial();

export type IUpdateBaseShareRo = z.infer<typeof updateBaseShareRoSchema>;

// Meta schema for public access - same as baseShareVoSchema now
export const baseShareMetaSchema = baseShareVoSchema.pick({
  password: true,
  nodeId: true,
  allowSave: true,
  allowCopy: true,
  allowEdit: true,
});

export type IBaseShareMeta = z.infer<typeof baseShareMetaSchema>;
