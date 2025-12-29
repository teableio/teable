/* eslint-disable sonarjs/no-duplicate-string */
import type {
  IExecutionContext,
  IRealtimeEngine,
  RealtimeChange,
  RealtimeDocId,
} from '@teable/v2-core';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

export class YjsRealtimeEngine implements IRealtimeEngine {
  async ensure(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _initial: unknown
  ): Promise<Result<void, string>> {
    return err('Not implemented');
  }

  async applyChange(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _change: RealtimeChange
  ): Promise<Result<void, string>> {
    return err('Not implemented');
  }

  async delete(_context: IExecutionContext, _docId: RealtimeDocId): Promise<Result<void, string>> {
    return err('Not implemented');
  }
}
