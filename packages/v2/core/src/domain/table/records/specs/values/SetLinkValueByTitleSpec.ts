import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableId } from '../../../TableId';
import type { TableRecord } from '../../TableRecord';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * Specification for setting a link field value by record titles.
 *
 * This spec is used in typecast mode when the user provides record titles
 * instead of record IDs. The Repository layer will use SQL subquery to
 * look up the actual record IDs from the foreign table.
 *
 * Example:
 * - User provides: ['Project A', 'Project B']
 * - Repository generates SQL like:
 *   UPDATE table SET field = (
 *     SELECT json_agg(json_build_object('id', id, 'title', primary_field))
 *     FROM foreign_table
 *     WHERE primary_field = ANY(['Project A', 'Project B'])
 *   )
 */
export class SetLinkValueByTitleSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  private constructor(
    readonly fieldId: FieldId,
    readonly foreignTableId: TableId,
    readonly titles: ReadonlyArray<string>
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    foreignTableId: TableId,
    titles: ReadonlyArray<string>
  ): SetLinkValueByTitleSpec {
    return new SetLinkValueByTitleSpec(fieldId, foreignTableId, titles);
  }

  /**
   * mutate cannot be executed in memory because it requires foreign table lookup.
   * The actual mutation is performed by the Repository via SQL.
   * The updated value will be retrieved via RETURNING clause.
   */
  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    // Return the original record; actual value is obtained from RETURNING
    return ok(record);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetLinkValueByTitle(this);
  }
}
