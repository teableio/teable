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
     * Strict (non-typecast) writes resolve bare `{ id }` references against the
     * table's collaborators only, matching v1. Typecast/paste snapshots stay
     * platform-scoped so a copied cell keeps its original member.
     */
    readonly requireCollaborator = false
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
