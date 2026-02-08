import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { BaseName } from '../domain/base/BaseName';
import { domainError, type DomainError } from '../domain/shared/DomainError';

export const createBaseInputSchema = z.object({
  baseId: z.string().optional(),
  name: z.string(),
});

export type ICreateBaseCommandInput = z.input<typeof createBaseInputSchema>;

export class CreateBaseCommand {
  private constructor(
    readonly baseId: BaseId | undefined,
    readonly baseName: BaseName
  ) {}

  static create(raw: unknown): Result<CreateBaseCommand, DomainError> {
    const parsed = createBaseInputSchema.safeParse(raw);
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid CreateBaseCommand input',
          details: z.formatError(parsed.error),
        })
      );

    const baseIdResult: Result<BaseId | undefined, DomainError> = parsed.data.baseId
      ? BaseId.create(parsed.data.baseId)
      : ok<BaseId | undefined, DomainError>(undefined);

    return baseIdResult.andThen((baseId) =>
      BaseName.create(parsed.data.name).map((baseName) => new CreateBaseCommand(baseId, baseName))
    );
  }
}
