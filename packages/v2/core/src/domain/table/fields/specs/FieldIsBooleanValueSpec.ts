import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { Field } from '../Field';
import { CellValueType } from '../types/CellValueType';
import { FieldValueTypeVisitor } from '../visitors/FieldValueTypeVisitor';

export class FieldIsBooleanValueSpec implements ISpecification<Field, ISpecVisitor> {
  private constructor() {}

  static create(): FieldIsBooleanValueSpec {
    return new FieldIsBooleanValueSpec();
  }

  isSatisfiedBy(field: Field): boolean {
    const valueResult = field.accept(new FieldValueTypeVisitor());
    if (valueResult.isErr()) return false;
    return valueResult.value.cellValueType.equals(CellValueType.boolean());
  }

  mutate(field: Field): Result<Field, string> {
    return ok(field);
  }

  accept(v: ISpecVisitor): Result<void, string> {
    return v.visit(this);
  }
}
