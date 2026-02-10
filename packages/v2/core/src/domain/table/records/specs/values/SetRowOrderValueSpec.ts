import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { ViewId } from '../../../views/ViewId';
import type { TableRecord } from '../../TableRecord';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * Specification for setting a view row order value.
 *
 * This updates the system column __row_{viewId} and does not affect
 * record field values. It is used for manual record reordering.
 */
export class SetRowOrderValueSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  constructor(
    readonly viewId: ViewId,
    readonly orderValue: number
  ) {
    super();
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return ok(record);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetRowOrderValue(this);
  }
}
