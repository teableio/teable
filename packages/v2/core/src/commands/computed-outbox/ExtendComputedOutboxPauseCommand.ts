import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

export const extendComputedOutboxPauseInputSchema = z.object({
  targetId: z.string().trim().min(1).max(128),
  leaseId: z.string().trim().min(1).max(128),
  durationMinutes: z.coerce.number().int().min(1).max(120),
});

export type IExtendComputedOutboxPauseCommandInput = z.input<
  typeof extendComputedOutboxPauseInputSchema
>;

export class ExtendComputedOutboxPauseCommand extends PublicCommand {
  private constructor(
    readonly targetId: string,
    readonly leaseId: string,
    readonly durationMinutes: number
  ) {
    super();
  }

  static create(raw: unknown): Result<ExtendComputedOutboxPauseCommand, DomainError> {
    const parsed = extendComputedOutboxPauseInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid ExtendComputedOutboxPauseCommand input' })
      );
    }
    return ok(
      new ExtendComputedOutboxPauseCommand(
        parsed.data.targetId,
        parsed.data.leaseId,
        parsed.data.durationMinutes
      )
    );
  }
}
