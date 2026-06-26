import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../ExecutionContext';
import type {
  IFieldDeleteSnapshotSinkCompletion,
  FieldDeleteSnapshotSinkInput,
  IFieldDeleteSnapshotSink,
} from '../FieldDeleteSnapshotSink';

export class NoopFieldDeleteSnapshotSink implements IFieldDeleteSnapshotSink {
  async prepare(
    _context: IExecutionContext,
    _input: FieldDeleteSnapshotSinkInput
  ): Promise<Result<IFieldDeleteSnapshotSinkCompletion | undefined, DomainError>> {
    return ok(undefined);
  }
}
