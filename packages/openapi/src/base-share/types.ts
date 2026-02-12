import { sharePasswordSchema } from '@teable/core';
import { z } from '../zod';

export const baseShareVoSchema = z.object({
  baseId: z.string(),
  shareId: z.string(),
  password: z.boolean(), // Only indicates if password is set, not the actual value
  nodeId: z.string(),
  allowSave: z.boolean().nullable(),
  allowCopy: z.boolean().nullable(),
  enabled: z.boolean(),
});

export type IBaseShareVo = z.infer<typeof baseShareVoSchema>;

// Input schemas need actual password for create/update
// nodeId is required; allowSave, allowCopy, password are optional
export const createBaseShareRoSchema = baseShareVoSchema
  .pick({ nodeId: true, allowSave: true, allowCopy: true })
  .partial({ allowSave: true, allowCopy: true })
  .extend({ password: sharePasswordSchema.nullable().optional() });

export type ICreateBaseShareRo = z.infer<typeof createBaseShareRoSchema>;

export const updateBaseShareRoSchema = baseShareVoSchema
  .pick({ allowSave: true, allowCopy: true, enabled: true })
  .extend({ password: sharePasswordSchema.nullable().optional() })
  .partial();

export type IUpdateBaseShareRo = z.infer<typeof updateBaseShareRoSchema>;

// Meta schema for public access - same as baseShareVoSchema now
export const baseShareMetaSchema = baseShareVoSchema.pick({
  password: true,
  nodeId: true,
  allowSave: true,
  allowCopy: true,
});

export type IBaseShareMeta = z.infer<typeof baseShareMetaSchema>;
