import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import { isNumericField } from '../fieldPredicates';

export class FieldIsNumberFieldSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor() {}

  static create(): FieldIsNumberFieldSpec {
    return new FieldIsNumberFieldSpec();
  }

  isSatisfiedBy(field: Field): boolean {
    return isNumericField(field);
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
