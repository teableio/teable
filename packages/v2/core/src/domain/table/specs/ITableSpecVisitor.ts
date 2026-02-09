import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type { TableAddFieldSpec } from './TableAddFieldSpec';
import type { TableAddSelectOptionsSpec } from './TableAddSelectOptionsSpec';
import type { TableByBaseIdSpec } from './TableByBaseIdSpec';
import type { TableByIdSpec } from './TableByIdSpec';
import type { TableByIdsSpec } from './TableByIdsSpec';
import type { TableByNameLikeSpec } from './TableByNameLikeSpec';
import type { TableByNameSpec } from './TableByNameSpec';
import type { TableDuplicateFieldSpec } from './TableDuplicateFieldSpec';
import type { TableRemoveFieldSpec } from './TableRemoveFieldSpec';
import type { TableRenameSpec } from './TableRenameSpec';
import type { TableUpdateViewColumnMetaSpec } from './TableUpdateViewColumnMetaSpec';

export interface ITableSpecVisitor<TResult = unknown> extends ISpecVisitor {
  visitTableAddField(spec: TableAddFieldSpec): Result<TResult, DomainError>;
  visitTableAddSelectOptions(spec: TableAddSelectOptionsSpec): Result<TResult, DomainError>;
  visitTableDuplicateField(spec: TableDuplicateFieldSpec): Result<TResult, DomainError>;
  visitTableRemoveField(spec: TableRemoveFieldSpec): Result<TResult, DomainError>;
  visitTableUpdateViewColumnMeta(spec: TableUpdateViewColumnMetaSpec): Result<TResult, DomainError>;
  visitTableRename(spec: TableRenameSpec): Result<TResult, DomainError>;
  visitTableByBaseId(spec: TableByBaseIdSpec): Result<TResult, DomainError>;
  visitTableById(spec: TableByIdSpec): Result<TResult, DomainError>;
  visitTableByIds(spec: TableByIdsSpec): Result<TResult, DomainError>;
  visitTableByName(spec: TableByNameSpec): Result<TResult, DomainError>;
  visitTableByNameLike(spec: TableByNameLikeSpec): Result<TResult, DomainError>;
}
