import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../DomainError';
import type { ISpecification } from '../ISpecification';
import type { ISpecVisitor } from '../ISpecVisitor';
import type { ISpecFilterVisitor } from './ISpecFilterVisitor';

const emptyWhereError = 'Empty where condition';

export abstract class AbstractSpecFilterVisitor<Cond>
  implements ISpecVisitor, ISpecFilterVisitor<Cond>
{
  private condValue: Cond | undefined;

  visit(_: ISpecification): Result<void, DomainError> {
    return ok(undefined);
  }

  addCond(cond: Cond): Result<void, DomainError> {
    const current = this.condValue;
    if (!current) {
      this.condValue = cond;
      return ok(undefined);
    }

    this.condValue = this.and(current, cond);
    return ok(undefined);
  }

  where(): Result<Cond, DomainError> {
    if (!this.condValue) return err(domainError.validation({ message: emptyWhereError }));
    return ok(this.condValue);
  }

  abstract clone(): this;
  abstract and(left: Cond, right: Cond): Cond;
  abstract or(left: Cond, right: Cond): Cond;
  abstract not(inner: Cond): Cond;
}
