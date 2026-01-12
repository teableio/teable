import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type { BaseByIdSpec } from './BaseByIdSpec';

export interface IBaseSpecVisitor<TResult = unknown> extends ISpecVisitor {
  visitBaseById(spec: BaseByIdSpec): Result<TResult, DomainError>;
}
