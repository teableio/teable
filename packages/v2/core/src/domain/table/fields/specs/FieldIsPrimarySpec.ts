import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import type { FieldId } from '../FieldId';

export class FieldIsPrimarySpec implements ISpecification<Field, ISpecVisitor> {
  private constructor(private readonly primaryFieldIdValue: FieldId) {}

  static create(primaryFieldId: FieldId): FieldIsPrimarySpec {
    return new FieldIsPrimarySpec(primaryFieldId);
  }

  primaryFieldId(): FieldId {
    return this.primaryFieldIdValue;
  }

  isSatisfiedBy(field: Field): boolean {
    return field.id().equals(this.primaryFieldIdValue);
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
