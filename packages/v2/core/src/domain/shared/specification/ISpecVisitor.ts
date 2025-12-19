/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Result } from 'neverthrow';

import type { ISpecification } from './ISpecification';

export interface ISpecVisitor {
  visit(spec: ISpecification<any, any>): Result<void, string>;
}
