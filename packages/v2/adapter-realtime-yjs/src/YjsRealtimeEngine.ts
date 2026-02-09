/* eslint-disable sonarjs/no-duplicate-string */
import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type IRealtimeEngine,
  type RealtimeChange,
  type RealtimeDocId,
} from '@teable/v2-core';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

export class YjsRealtimeEngine implements IRealtimeEngine {
  async ensure(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _initial: unknown
  ): Promise<Result<void, DomainError>> {
    return err(domainError.notImplemented({ message: 'Not implemented' }));
  }

  async applyChange(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _change: RealtimeChange | ReadonlyArray<RealtimeChange>
  ): Promise<Result<void, DomainError>> {
    return err(domainError.notImplemented({ message: 'Not implemented' }));
  }

  async delete(
    _context: IExecutionContext,
    _docId: RealtimeDocId
  ): Promise<Result<void, DomainError>> {
    return err(domainError.notImplemented({ message: 'Not implemented' }));
  }
}
