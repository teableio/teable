import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import type { FieldId } from '../FieldId';

export class FieldByIdSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor(private readonly fieldIdValue: FieldId) {}

  static create(fieldId: FieldId): FieldByIdSpec {
    return new FieldByIdSpec(fieldId);
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  isSatisfiedBy(field: Field): boolean {
    return field.id().equals(this.fieldIdValue);
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
