import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { MutateOnlySpec } from '../../../shared/specification/MutateOnlySpec';
import type { Field } from '../../fields/Field';
import type { FieldId } from '../../fields/FieldId';
import type { Table } from '../../Table';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';

/**
 * Specification for removing a symmetric link field during twoWay → oneWay conversion.
 *
 * Unlike TableRemoveFieldSpec, this spec ONLY removes:
 * - The field from the table's field list
 * - The link field's JSONB column
 *
 * It does NOT remove:
 * - The shared junction table (still needed by the source field)
 *
 * This is needed because the symmetric field shares the junction table with
 * the source field, so we can't drop it when converting to oneWay.
 */
export class RemoveSymmetricLinkFieldSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(private readonly fieldValue: Field) {
    super();
  }

  static create(field: Field): RemoveSymmetricLinkFieldSpec {
    return new RemoveSymmetricLinkFieldSpec(field);
  }

  field(): Field {
    return this.fieldValue;
  }

  fieldId(): FieldId {
    return this.fieldValue.id();
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.removeField(this.fieldValue.id());
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitRemoveSymmetricLinkField(this).map(() => undefined);
  }
}
