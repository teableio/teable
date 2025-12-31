import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import { CellValueType } from '../types/CellValueType';
import { FieldValueTypeVisitor } from '../visitors/FieldValueTypeVisitor';

export class FieldIsStringValueSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor() {}

  static create(): FieldIsStringValueSpec {
    return new FieldIsStringValueSpec();
  }

  isSatisfiedBy(field: Field): boolean {
    const valueResult = field.accept(new FieldValueTypeVisitor());
    if (valueResult.isErr()) return false;
    return valueResult.value.cellValueType.equals(CellValueType.string());
  }

  mutate(field: Field): Result<Field, DomainError> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, DomainError> {
    return v.visit(this);
  }
}
