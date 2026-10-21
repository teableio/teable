import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { computedOutboxAnomalyKinds } from '../../domain/computed/outbox';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

export const recoverComputedOutboxAnomalyInputSchema = z.object({
  targetId: z.string().min(1).max(128),
  taskId: z.string().min(1).max(128),
  kind: z.enum(computedOutboxAnomalyKinds),
});

export type IRecoverComputedOutboxAnomalyCommandInput = z.input<
  typeof recoverComputedOutboxAnomalyInputSchema
>;

export class RecoverComputedOutboxAnomalyCommand extends PublicCommand {
  private constructor(
    readonly targetId: string,
    readonly taskId: string,
    readonly kind: (typeof computedOutboxAnomalyKinds)[number]
  ) {
    super();
  }

  static create(raw: unknown): Result<RecoverComputedOutboxAnomalyCommand, DomainError> {
    const parsed = recoverComputedOutboxAnomalyInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({ message: 'Invalid RecoverComputedOutboxAnomalyCommand input' })
      );
    }
    return ok(
      new RecoverComputedOutboxAnomalyCommand(
        parsed.data.targetId,
        parsed.data.taskId,
        parsed.data.kind
      )
    );
  }
}
