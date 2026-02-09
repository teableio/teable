import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import { FieldType } from '../FieldType';

export class FieldIsLongTextSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor() {}

  static create(): FieldIsLongTextSpec {
    return new FieldIsLongTextSpec();
  }

  isSatisfiedBy(field: Field): boolean {
    return field.type().equals(FieldType.longText());
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
