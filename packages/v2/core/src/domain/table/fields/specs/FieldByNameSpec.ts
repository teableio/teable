import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import type { FieldName } from '../FieldName';

export class FieldByNameSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor(private readonly fieldNameValue: FieldName) {}

  static create(fieldName: FieldName): FieldByNameSpec {
    return new FieldByNameSpec(fieldName);
  }

  fieldName(): FieldName {
    return this.fieldNameValue;
  }

  isSatisfiedBy(field: Field): boolean {
    return field.name().equals(this.fieldNameValue);
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
