import type { Result } from 'neverthrow';

import type { DomainError } from '../DomainError';
import type { ISpecVisitor } from './ISpecVisitor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ISpecification<T = any, V extends ISpecVisitor = ISpecVisitor> {
  isSatisfiedBy(t: T): boolean;
  mutate(t: T): Result<T, DomainError>;
  accept(v: V): Result<void, DomainError>;
}
