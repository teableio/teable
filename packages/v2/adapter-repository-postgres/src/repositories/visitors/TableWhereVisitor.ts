import {
  AbstractSpecFilterVisitor,
  type ITableSpecVisitor,
  TableAddFieldSpec,
  TableRemoveFieldSpec,
  TableUpdateViewColumnMetaSpec,
  TableRenameSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  domainError,
  type DomainError,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

export type ITableMetaWhere = (
  eb: ExpressionBuilder<V1TeableDatabase, 'table_meta'>
) => Expression<SqlBool>;

export class TableWhereVisitor
  extends AbstractSpecFilterVisitor<ITableMetaWhere>
  implements ITableSpecVisitor<ITableMetaWhere>
{
  constructor() {
    super();
    this.addCond((eb) => eb.eb('deleted_time', 'is', null));
  }

  visitTableAddField(_: TableAddFieldSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'TableAddFieldSpec is not supported for table filters' })
    );
  }

  visitTableRemoveField(_: TableRemoveFieldSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'TableRemoveFieldSpec is not supported for table filters' })
    );
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateViewColumnMetaSpec is not supported for table filters',
      })
    );
  }

  visitTableRename(_: TableRenameSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'TableRenameSpec is not supported for table filters' })
    );
  }

  visitTableByBaseId(spec: TableByBaseIdSpec): Result<ITableMetaWhere, DomainError> {
    const cond: ITableMetaWhere = (eb) => eb.eb('base_id', '=', spec.baseId().toString());
    return this.addCond(cond).map(() => cond);
  }

  visitTableById(spec: TableByIdSpec): Result<ITableMetaWhere, DomainError> {
    const cond: ITableMetaWhere = (eb) => eb.eb('id', '=', spec.tableId().toString());
    return this.addCond(cond).map(() => cond);
  }

  visitTableByIds(spec: TableByIdsSpec): Result<ITableMetaWhere, DomainError> {
    const ids = spec.tableIds().map((id) => id.toString());
    if (ids.length === 0)
      return err(domainError.unexpected({ message: 'TableByIdsSpec requires at least one id' }));
    const cond: ITableMetaWhere = (eb) => eb.eb('id', 'in', ids);
    return this.addCond(cond).map(() => cond);
  }

  visitTableByName(spec: TableByNameSpec): Result<ITableMetaWhere, DomainError> {
    const cond: ITableMetaWhere = (eb) => eb.eb('name', '=', spec.tableName().toString());
    return this.addCond(cond).map(() => cond);
  }

  visitTableByNameLike(spec: TableByNameLikeSpec): Result<ITableMetaWhere, DomainError> {
    const pattern = `%${spec.tableName().toString()}%`;
    const cond: ITableMetaWhere = (eb) => eb.eb('name', 'like', pattern);
    return this.addCond(cond).map(() => cond);
  }

  clone(): this {
    return new TableWhereVisitor() as this;
  }

  and(left: ITableMetaWhere, right: ITableMetaWhere): ITableMetaWhere {
    return (eb) => eb.and([left(eb), right(eb)]);
  }

  or(left: ITableMetaWhere, right: ITableMetaWhere): ITableMetaWhere {
    return (eb) => eb.or([left(eb), right(eb)]);
  }

  not(inner: ITableMetaWhere): ITableMetaWhere {
    return (eb) => eb.not(inner(eb));
  }
}
