import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { DomainError } from '../domain/shared/DomainError';
import { domainError } from '../domain/shared/DomainError';
import { UserId } from '../domain/table/fields/types/UserId';
import { InternalCommand } from './InternalCommand';

const propagateUserRenameInputSchema = z.object({
  userId: z.string(),
  name: z.string().trim().min(1, 'User name is required'),
});

export type IPropagateUserRenameCommandInput = z.input<typeof propagateUserRenameInputSchema>;

export class PropagateUserRenameCommand extends InternalCommand {
  private constructor(
    readonly userId: UserId,
    readonly name: string
  ) {
    super();
  }

  static create(raw: unknown): Result<PropagateUserRenameCommand, DomainError> {
    const parsed = propagateUserRenameInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid PropagateUserRenameCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return UserId.create(parsed.data.userId).map(
      (userId) => new PropagateUserRenameCommand(userId, parsed.data.name)
    );
  }
}
