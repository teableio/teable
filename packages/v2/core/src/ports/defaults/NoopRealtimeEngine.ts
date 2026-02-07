import { ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../ExecutionContext';
import type { RealtimeChange } from '../RealtimeChange';
import type { RealtimeDocId } from '../RealtimeDocId';
import type { IRealtimeEngine } from '../RealtimeEngine';

export class NoopRealtimeEngine implements IRealtimeEngine {
  async ensure(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _initial: unknown
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async applyChange(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _change: RealtimeChange | ReadonlyArray<RealtimeChange>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(
    _context: IExecutionContext,
    _docId: RealtimeDocId
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
