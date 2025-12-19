import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';
import { isSpecFilterVisitor } from './visitors/ISpecFilterVisitor';

export class OrSpec<T, V extends ISpecVisitor = ISpecVisitor> implements ISpecification<T, V> {
  constructor(
    private readonly left: ISpecification<T, V>,
    private readonly right: ISpecification<T, V>
  ) {}

  isSatisfiedBy(t: T): boolean {
    return this.left.isSatisfiedBy(t) || this.right.isSatisfiedBy(t);
  }

  mutate(t: T): Result<T, string> {
    if (this.left.isSatisfiedBy(t)) return this.left.mutate(t);
    if (this.right.isSatisfiedBy(t)) return this.right.mutate(t);
    return ok(t);
  }

  accept(v: V): Result<void, string> {
    if (isSpecFilterVisitor(v)) {
      const leftVisitor = v.clone();
      const rightVisitor = v.clone();

      return this.left
        .accept(leftVisitor as unknown as V)
        .andThen(() => this.right.accept(rightVisitor as unknown as V))
        .andThen(() => leftVisitor.where())
        .andThen((leftCond) => rightVisitor.where().map((rightCond) => v.or(leftCond, rightCond)))
        .andThen((cond) => v.addCond(cond))
        .map(() => undefined);
    }

    return v
      .visit(this)
      .andThen(() => this.left.accept(v))
      .andThen(() => this.right.accept(v))
      .map(() => undefined);
  }
}

export const orSpec = <T, V extends ISpecVisitor = ISpecVisitor>(
  left: ISpecification<T, V>,
  right: ISpecification<T, V>
): Result<OrSpec<T, V>, string> => ok(new OrSpec(left, right));
