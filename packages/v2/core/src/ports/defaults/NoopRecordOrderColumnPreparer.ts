import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import type { ViewId } from '../../domain/table/views/ViewId';
import type { IExecutionContext } from '../ExecutionContext';
import type { IRecordOrderColumnPreparer } from '../RecordOrderColumnPreparer';

/** Default until a row-order-capable adapter provides real preparation. */
export class NoopRecordOrderColumnPreparer implements IRecordOrderColumnPreparer {
  async prepareOrderColumn(
    _context: IExecutionContext,
    _table: Table,
    _viewId: ViewId
  ): Promise<Result<boolean, DomainError>> {
    return ok(false);
  }
}
