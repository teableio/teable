import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../ExecutionContext';
import type {
  FieldDeleteSnapshotSinkInput,
  IFieldDeleteSnapshotSink,
} from '../FieldDeleteSnapshotSink';

export class NoopFieldDeleteSnapshotSink implements IFieldDeleteSnapshotSink {
  async prepare(
    _context: IExecutionContext,
    _input: FieldDeleteSnapshotSinkInput
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
