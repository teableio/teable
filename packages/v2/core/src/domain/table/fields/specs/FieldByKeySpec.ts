import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';

/**
 * Specification that matches a field by key (either ID or name).
 * Automatically checks both field.id() and field.name() for a match.
 */
export class FieldByKeySpec implements ISpecification<Field, ISpecVisitor> {
  private constructor(private readonly keyValue: string) {}

  static create(key: string): FieldByKeySpec {
    return new FieldByKeySpec(key);
  }

  key(): string {
    return this.keyValue;
  }

  isSatisfiedBy(field: Field): boolean {
    return field.id().toString() === this.keyValue || field.name().toString() === this.keyValue;
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
