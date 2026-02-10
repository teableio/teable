import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../DomainError';
import type { ISpecification } from '../ISpecification';
import type { ISpecVisitor } from '../ISpecVisitor';

export class NoopSpecVisitor implements ISpecVisitor {
  visit(_: ISpecification): Result<void, DomainError> {
    return ok(undefined);
  }
}
