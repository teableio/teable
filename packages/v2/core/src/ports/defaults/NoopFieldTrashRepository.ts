import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../ExecutionContext';
import type { FieldTrashSnapshot, IFieldTrashRepository } from '../FieldTrashRepository';

export class NoopFieldTrashRepository implements IFieldTrashRepository {
  async getFieldTrash(
    _context: IExecutionContext,
    _tableId: string,
    _trashId: string
  ): Promise<Result<FieldTrashSnapshot, DomainError>> {
    return err(
      domainError.unexpected({
        message: 'FieldTrashRepository is not configured',
        code: 'restore_field_stream.repository_not_configured',
      })
    );
  }

  async deleteFieldTrash(
    _context: IExecutionContext,
    _tableId: string,
    _trashId: string
  ): Promise<Result<void, DomainError>> {
    return err(
      domainError.unexpected({
        message: 'FieldTrashRepository is not configured',
        code: 'restore_field_stream.repository_not_configured',
      })
    );
  }
}
