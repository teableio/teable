import type { Result } from 'neverthrow';

import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type { TableByBaseIdSpec } from './TableByBaseIdSpec';
import type { TableByIdSpec } from './TableByIdSpec';
import type { TableByNameLikeSpec } from './TableByNameLikeSpec';
import type { TableByNameSpec } from './TableByNameSpec';

export interface ITableSpecVisitor<TResult = unknown> extends ISpecVisitor {
  visitTableByBaseId(spec: TableByBaseIdSpec): Result<TResult, string>;
  visitTableById(spec: TableByIdSpec): Result<TResult, string>;
  visitTableByName(spec: TableByNameSpec): Result<TResult, string>;
  visitTableByNameLike(spec: TableByNameLikeSpec): Result<TResult, string>;
}
