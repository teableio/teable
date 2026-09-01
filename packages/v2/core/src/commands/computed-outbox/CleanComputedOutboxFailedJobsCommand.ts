import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { PublicCommand } from '../PublicCommand';

export class CleanComputedOutboxFailedJobsCommand extends PublicCommand {
  private constructor() {
    super();
  }

  static create(_raw?: unknown): Result<CleanComputedOutboxFailedJobsCommand, DomainError> {
    return ok(new CleanComputedOutboxFailedJobsCommand());
  }
}
