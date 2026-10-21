import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

export const discardComputedOutboxAnomalyBatchInputSchema = z.object({
  targetId: z.string().min(1).max(128),
  baseId: z.string().min(1).max(128),
  seedTableId: z.string().min(1).max(128),
  errorSignature: z.string().max(500),
});

export type IDiscardComputedOutboxAnomalyBatchCommandInput = z.input<
  typeof discardComputedOutboxAnomalyBatchInputSchema
>;

export class DiscardComputedOutboxAnomalyBatchCommand extends PublicCommand {
  private constructor(
    readonly targetId: string,
    readonly baseId: string,
    readonly seedTableId: string,
    readonly errorSignature: string
  ) {
    super();
  }

  static create(raw: unknown): Result<DiscardComputedOutboxAnomalyBatchCommand, DomainError> {
    const parsed = discardComputedOutboxAnomalyBatchInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid DiscardComputedOutboxAnomalyBatchCommand input',
        })
      );
    }
    return ok(
      new DiscardComputedOutboxAnomalyBatchCommand(
        parsed.data.targetId,
        parsed.data.baseId,
        parsed.data.seedTableId,
        parsed.data.errorSignature
      )
    );
  }
}
