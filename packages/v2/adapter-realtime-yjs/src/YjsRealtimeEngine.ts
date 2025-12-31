/* eslint-disable sonarjs/no-duplicate-string */
import type {
  IExecutionContext,
  IRealtimeEngine,
  RealtimeChange,
  RealtimeDocId,
} from '@teable/v2-core';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '@teable/v2-core';
export class YjsRealtimeEngine implements IRealtimeEngine {
  async ensure(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _initial: unknown
  ): Promise<Result<void, DomainError>> {
    return err(domainError.fromMessage('Not implemented'));
  }

  async applyChange(
    _context: IExecutionContext,
    _docId: RealtimeDocId,
    _change: RealtimeChange
  ): Promise<Result<void, DomainError>> {
    return err(domainError.fromMessage('Not implemented'));
  }

  async delete(
    _context: IExecutionContext,
    _docId: RealtimeDocId
  ): Promise<Result<void, DomainError>> {
    return err(domainError.fromMessage('Not implemented'));
  }
}
