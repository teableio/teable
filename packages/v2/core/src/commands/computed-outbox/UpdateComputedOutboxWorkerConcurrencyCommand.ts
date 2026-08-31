import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

export const updateComputedOutboxWorkerConcurrencyInputSchema = z.object({
  concurrency: z.number().int().min(1).max(64).nullable(),
});

export type IUpdateComputedOutboxWorkerConcurrencyCommandInput = z.input<
  typeof updateComputedOutboxWorkerConcurrencyInputSchema
>;

export class UpdateComputedOutboxWorkerConcurrencyCommand extends PublicCommand {
  private constructor(readonly concurrency: number | null) {
    super();
  }

  static create(raw: unknown): Result<UpdateComputedOutboxWorkerConcurrencyCommand, DomainError> {
    const parsed = updateComputedOutboxWorkerConcurrencyInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateComputedOutboxWorkerConcurrencyCommand input',
        })
      );
    }
    return ok(new UpdateComputedOutboxWorkerConcurrencyCommand(parsed.data.concurrency));
  }
}
