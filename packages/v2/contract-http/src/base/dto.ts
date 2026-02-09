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
