import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import { FieldType } from '../FieldType';

export class FieldIsJsonSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor() {}

  static create(): FieldIsJsonSpec {
    return new FieldIsJsonSpec();
  }

  isSatisfiedBy(field: Field): boolean {
    const type = field.type();
    return (
      type.equals(FieldType.link()) ||
      type.equals(FieldType.user()) ||
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
