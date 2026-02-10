import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Base } from '../Base';
import type { BaseId } from '../BaseId';
import type { IBaseSpecVisitor } from './IBaseSpecVisitor';

export class BaseByIdSpec<V extends IBaseSpecVisitor = IBaseSpecVisitor>
  implements ISpecification<Base, V>
{
  private constructor(private readonly baseIdValue: BaseId) {}

  static create(baseId: BaseId): BaseByIdSpec {
    return new BaseByIdSpec(baseId);
  }

  baseId(): BaseId {
    return this.baseIdValue;
  }

  isSatisfiedBy(b: Base): boolean {
    return b.id().equals(this.baseIdValue);
  }

  mutate(b: Base): Result<Base, DomainError> {
    return ok(b);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitBaseById(this).map(() => undefined);
  }
}
