import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';

export class ListComputedOutboxPausesQuery {
  private constructor() {}

  static create(_raw?: unknown): Result<ListComputedOutboxPausesQuery, DomainError> {
    return ok(new ListComputedOutboxPausesQuery());
  }
}
