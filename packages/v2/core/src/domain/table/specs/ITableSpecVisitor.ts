import type { Result } from 'neverthrow';

import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type { TableAddFieldSpec } from './TableAddFieldSpec';
import type { TableByBaseIdSpec } from './TableByBaseIdSpec';
import type { TableByIdSpec } from './TableByIdSpec';
import type { TableByIdsSpec } from './TableByIdsSpec';
import type { TableByNameLikeSpec } from './TableByNameLikeSpec';
import type { TableByNameSpec } from './TableByNameSpec';
import type { TableUpdateViewColumnMetaSpec } from './TableUpdateViewColumnMetaSpec';

export interface ITableSpecVisitor<TResult = unknown> extends ISpecVisitor {
  visitTableAddField(spec: TableAddFieldSpec): Result<TResult, string>;
  visitTableUpdateViewColumnMeta(spec: TableUpdateViewColumnMetaSpec): Result<TResult, string>;
  visitTableByBaseId(spec: TableByBaseIdSpec): Result<TResult, string>;
  visitTableById(spec: TableByIdSpec): Result<TResult, string>;
  visitTableByIds(spec: TableByIdsSpec): Result<TResult, string>;
  visitTableByName(spec: TableByNameSpec): Result<TResult, string>;
  visitTableByNameLike(spec: TableByNameLikeSpec): Result<TResult, string>;
}
