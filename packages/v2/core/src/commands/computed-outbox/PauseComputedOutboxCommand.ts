import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

export const pauseComputedOutboxInputSchema = z.object({
  spaceId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(500).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(120).optional(),
});

export type IPauseComputedOutboxCommandInput = z.input<typeof pauseComputedOutboxInputSchema>;

export class PauseComputedOutboxCommand extends PublicCommand {
  private constructor(
    readonly spaceId: string,
    readonly reason: string | undefined,
    readonly durationMinutes: number | undefined
  ) {
    super();
  }

  static create(raw: unknown): Result<PauseComputedOutboxCommand, DomainError> {
    const parsed = pauseComputedOutboxInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid PauseComputedOutboxCommand input' }));
    }
    return ok(
      new PauseComputedOutboxCommand(
        parsed.data.spaceId,
        parsed.data.reason,
        parsed.data.durationMinutes
      )
    );
  }
}
