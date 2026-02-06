import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../DomainError';
import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';

export class AndSpec<T, V extends ISpecVisitor = ISpecVisitor> implements ISpecification<T, V> {
  constructor(
    private readonly left: ISpecification<T, V>,
    private readonly right: ISpecification<T, V>
  ) {}

  leftSpec(): ISpecification<T, V> {
    return this.left;
  }

  rightSpec(): ISpecification<T, V> {
    return this.right;
  }

  isSatisfiedBy(t: T): boolean {
    return this.left.isSatisfiedBy(t) && this.right.isSatisfiedBy(t);
  }

  mutate(t: T): Result<T, DomainError> {
    return this.left.mutate(t).andThen((next) => this.right.mutate(next));
  }

  accept(v: V): Result<void, DomainError> {
    return v
      .visit(this)
      .andThen(() => this.left.accept(v))
      .andThen(() => this.right.accept(v))
      .map(() => undefined);
  }
}

export const andSpec = <T, V extends ISpecVisitor = ISpecVisitor>(
  left: ISpecification<T, V>,
  right: ISpecification<T, V>
): Result<AndSpec<T, V>, DomainError> => ok(new AndSpec(left, right));
