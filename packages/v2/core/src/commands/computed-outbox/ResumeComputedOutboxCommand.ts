import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { computedOutboxPauseScopeTypes } from '../../domain/computed/outbox';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

export const resumeComputedOutboxInputSchema = z.object({
  targetId: z.string().trim().min(1).max(128),
  scopeType: z.enum(computedOutboxPauseScopeTypes),
  scopeId: z.string().trim().min(1).max(128),
});

export type IResumeComputedOutboxCommandInput = z.input<typeof resumeComputedOutboxInputSchema>;

export class ResumeComputedOutboxCommand extends PublicCommand {
  private constructor(
    readonly targetId: string,
    readonly scopeType: (typeof computedOutboxPauseScopeTypes)[number],
    readonly scopeId: string
  ) {
    super();
  }

  static create(raw: unknown): Result<ResumeComputedOutboxCommand, DomainError> {
    const parsed = resumeComputedOutboxInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid ResumeComputedOutboxCommand input' }));
    }
    return ok(
      new ResumeComputedOutboxCommand(
        parsed.data.targetId,
        parsed.data.scopeType,
        parsed.data.scopeId
      )
    );
  }
}
