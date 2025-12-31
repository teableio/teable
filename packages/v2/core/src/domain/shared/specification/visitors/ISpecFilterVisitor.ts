import type { Result } from 'neverthrow';

import type { DomainError } from '../../DomainError';
export interface ISpecFilterVisitor<Cond> {
  clone(): this;
  and(left: Cond, right: Cond): Cond;
  or(left: Cond, right: Cond): Cond;
  not(inner: Cond): Cond;
  addCond(cond: Cond): Result<void, DomainError>;
  where(): Result<Cond, DomainError>;
}

export const isSpecFilterVisitor = (v: unknown): v is ISpecFilterVisitor<unknown> => {
  if (!v || typeof v !== 'object') return false;
  const maybe = v as Record<string, unknown>;
  return (
    typeof maybe.clone === 'function' &&
    typeof maybe.and === 'function' &&
    typeof maybe.or === 'function' &&
    typeof maybe.not === 'function' &&
    typeof maybe.addCond === 'function' &&
    typeof maybe.where === 'function'
  );
};
