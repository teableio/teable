import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableRecord } from '../../TableRecord';
import type { CellValue } from '../../values/CellValue';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * User item structure representing a user reference
 */
export interface UserItem {
  id: string;
  title: string;
  email?: string;
  avatarUrl?: string;
}

/**
 * Specification for setting a user field value.
 * The value should be an array of user items.
 */
export class SetUserValueSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  constructor(
    readonly fieldId: FieldId,
    readonly value: CellValue<UserItem[]>,
    /**
     * Caller-controlled references resolve in table scope, except an exact
     * active id/email pair may identify a user outside it. Only server-created
     * specs for trusted existing values may use the default; never expose this flag in input.
     */
    readonly requireCollaborator = false,
    /** Additional input items to validate before selecting a single user. */
    readonly itemsToValidate?: ReadonlyArray<UserItem>
  ) {
    super();
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return record.setFieldValue(this.fieldId, this.value);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetUserValue(this);
  }
}
