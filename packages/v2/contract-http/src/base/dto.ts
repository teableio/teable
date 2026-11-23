import type { Base, DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

export const baseDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type IBaseDto = z.infer<typeof baseDtoSchema>;

export const mapBaseToDto = (base: Base): Result<IBaseDto, DomainError> => {
  return ok({
    id: base.id().toString(),
    name: base.name().toString(),
  });
};

/** Host discovery metadata; independent of the legacy REST client and its runtime graph. */
export const baseListItemDtoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  spaceId: z.string(),
  icon: z.string().nullable(),
  role: z.enum(['owner', 'creator', 'editor', 'commenter', 'viewer']),
  collaboratorType: z.enum(['space', 'base']).optional(),
  restrictedAuthority: z.boolean().optional(),
  enabledAuthority: z.boolean().optional(),
  lastModifiedTime: z.string().nullable().optional(),
  createdTime: z.string().nullable().optional(),
  createdBy: z.string(),
  personalOrder: z.number().optional(),
  template: z.object({ id: z.string(), headers: z.string() }).optional(),
  createdUser: z
    .object({
      id: z.string(),
      name: z.string(),
      avatar: z.string().nullable().optional(),
    })
    .optional(),
  isCanary: z.boolean().optional(),
  v2Status: z
    .object({
      useV2: z.boolean(),
      reason: z.enum([
        'env_force_v2_all',
        'config_force_v2_all',
        'new_base',
        'native_only',
        'header_override',
        'space_feature',
        'unsupported_feature',
        'undo_redo_engine',
        'disabled',
        'feature_not_enabled',
        'no_feature',
      ]),
    })
    .optional(),
  isShared: z.boolean().optional(),
});
