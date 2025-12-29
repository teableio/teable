import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IExecutionContext } from '../ExecutionContext';
import type { RealtimeChange } from '../RealtimeChange';
import type { RealtimeDocId } from '../RealtimeDocId';
import type { IRealtimeEngine } from '../RealtimeEngine';

export class NoopRealtimeEngine implements IRealtimeEngine {
  async ensure(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _initial: unknown
  ): Promise<Result<void, string>> {
    return ok(undefined);
  }

  async applyChange(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _change: RealtimeChange
  ): Promise<Result<void, string>> {
    return ok(undefined);
  }
}
