import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type {
  BaseDataBulkCopyPlan,
  BaseDataBulkCopyProgress,
  BaseDataBulkCopyResult,
  IBaseDataBulkCopier,
} from '../BaseDataBulkCopier';
import type { IExecutionContext } from '../ExecutionContext';

export class NoopBaseDataBulkCopier implements IBaseDataBulkCopier {
  async isSupported(
    _context: IExecutionContext,
    _plan: BaseDataBulkCopyPlan
  ): Promise<Result<boolean, DomainError>> {
    return ok(false);
  }

  async copyBaseData(
    _context: IExecutionContext,
    _plan: BaseDataBulkCopyPlan,
    _onProgress?: (progress: BaseDataBulkCopyProgress) => void
  ): Promise<Result<BaseDataBulkCopyResult, DomainError>> {
    return ok({ recordsLength: 0 });
  }
}
