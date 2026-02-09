import type { Result } from 'neverthrow';

import type { DomainError } from '../DomainError';
import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';

export abstract class MutateOnlySpec<T, V extends ISpecVisitor = ISpecVisitor>
  implements ISpecification<T, V>
{
  isSatisfiedBy(_: T): boolean {
    return true;
  }

  abstract mutate(t: T): Result<T, DomainError>;
  abstract accept(v: V): Result<void, DomainError>;
}
