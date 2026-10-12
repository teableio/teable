import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { ILegacyEventDispatcher, LegacyEventDispatchReport } from '../LegacyEventDispatcher';
import type {
  ITransactionalProjectionMessageJournal,
  ProjectionMessageRef,
} from '../TransactionalProjectionMessageJournal';

export class NoopProjectionMessageJournal implements ITransactionalProjectionMessageJournal {
  async append(): Promise<Result<ReadonlyArray<ProjectionMessageRef>, DomainError>> {
    return ok([]);
  }
}

export class NoopLegacyEventDispatcher implements ILegacyEventDispatcher {
  async dispatch(): Promise<LegacyEventDispatchReport> {
    return { attemptedTargets: 0, failedTargets: 0, failureCodes: [] };
  }
}
