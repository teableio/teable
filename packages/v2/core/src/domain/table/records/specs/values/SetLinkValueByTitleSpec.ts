import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableId } from '../../../TableId';
import type { TableRecord } from '../../TableRecord';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * Specification for setting a link field value by its display-field titles.
 *
 * Created in typecast mode when the caller provides values copied from the
 * foreign table instead of record IDs. `lookupFieldId` is the link's display
 * field; resolution matches its stored value, falling back to the primary
 * field when the caller does not supply one.
 * Free-form typecast strings can also request record ID disambiguation before
 * falling back to title lookup.
 */
export class SetLinkValueByTitleSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  private constructor(
    readonly fieldId: FieldId,
    readonly foreignTableId: TableId,
    readonly titles: ReadonlyArray<string>,
    readonly isMultiple: boolean,
    readonly lookupFieldId?: FieldId,
    readonly resolveRecordIds = false
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    foreignTableId: TableId,
    titles: ReadonlyArray<string>,
    isMultiple = true,
    lookupFieldId?: FieldId,
    resolveRecordIds = false
  ): SetLinkValueByTitleSpec {
    return new SetLinkValueByTitleSpec(
      fieldId,
      foreignTableId,
      titles,
      isMultiple,
      lookupFieldId,
      resolveRecordIds
    );
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
