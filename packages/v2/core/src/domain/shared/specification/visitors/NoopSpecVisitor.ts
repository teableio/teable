import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../ISpecification';
import type { ISpecVisitor } from '../ISpecVisitor';

export class NoopSpecVisitor implements ISpecVisitor {
  visit(_: ISpecification): Result<void, string> {
    return ok(undefined);
  }
}
