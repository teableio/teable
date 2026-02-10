import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import { FieldType } from '../FieldType';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { LookupField } from '../types/LookupField';

export class FieldIsJsonSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor() {}

  static create(): FieldIsJsonSpec {
    return new FieldIsJsonSpec();
  }

  isSatisfiedBy(field: Field): boolean {
    const type = field.type();
    if (type.equals(FieldType.lookup())) {
      const lookupField = field as LookupField;
      const innerResult = lookupField.innerField();
      return innerResult.isOk() ? this.isSatisfiedBy(innerResult.value) : false;
    }
    if (type.equals(FieldType.conditionalLookup())) {
      const lookupField = field as ConditionalLookupField;
      const innerResult = lookupField.innerField();
      return innerResult.isOk() ? this.isSatisfiedBy(innerResult.value) : false;
    }
    return (
      type.equals(FieldType.link()) ||
      type.equals(FieldType.user()) ||
      type.equals(FieldType.createdBy()) ||
      type.equals(FieldType.lastModifiedBy()) ||
      type.equals(FieldType.button()) ||
      type.equals(FieldType.attachment())
    );
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
