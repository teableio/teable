import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

const claimConcurrencyValueSchema = z.number().int().min(1).max(16).nullable();

export const updateComputedOutboxClaimConcurrencyInputSchema = z.object({
  perBase: claimConcurrencyValueSchema,
  perSeedTable: claimConcurrencyValueSchema,
});

export type IUpdateComputedOutboxClaimConcurrencyCommandInput = z.input<
  typeof updateComputedOutboxClaimConcurrencyInputSchema
>;

export class UpdateComputedOutboxClaimConcurrencyCommand extends PublicCommand {
  private constructor(
    readonly perBase: number | null,
    readonly perSeedTable: number | null
  ) {
    super();
  }

  static create(raw: unknown): Result<UpdateComputedOutboxClaimConcurrencyCommand, DomainError> {
    const parsed = updateComputedOutboxClaimConcurrencyInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid UpdateComputedOutboxClaimConcurrencyCommand input',
        })
      );
    }
    return ok(
      new UpdateComputedOutboxClaimConcurrencyCommand(parsed.data.perBase, parsed.data.perSeedTable)
    );
  }
}
