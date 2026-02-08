import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../DomainError';
import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';
import { isSpecFilterVisitor } from './visitors/ISpecFilterVisitor';

export class NotSpec<T, V extends ISpecVisitor = ISpecVisitor> implements ISpecification<T, V> {
  constructor(private readonly inner: ISpecification<T, V>) {}

  innerSpec(): ISpecification<T, V> {
    return this.inner;
  }

  isSatisfiedBy(t: T): boolean {
    return !this.inner.isSatisfiedBy(t);
  }

  mutate(t: T): Result<T, DomainError> {
    return ok(t);
  }

  accept(v: V): Result<void, DomainError> {
    const visited = v.visit(this);
    if (isSpecFilterVisitor(v)) {
      const innerVisitor = v.clone();

      return visited
        .andThen(() => this.inner.accept(innerVisitor as unknown as V))
        .andThen(() => innerVisitor.where())
        .map((innerCond) => v.not(innerCond))
        .andThen((cond) => v.addCond(cond))
        .map(() => undefined);
    }

    return visited.andThen(() => this.inner.accept(v)).map(() => undefined);
  }
}

export const notSpec = <T, V extends ISpecVisitor = ISpecVisitor>(
  inner: ISpecification<T, V>
): Result<NotSpec<T, V>, DomainError> => ok(new NotSpec(inner));
