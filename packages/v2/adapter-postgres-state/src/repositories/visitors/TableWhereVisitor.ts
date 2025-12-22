import {
  AbstractSpecFilterVisitor,
  type ISpecification,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Expression, ExpressionBuilder, SqlBool } from 'kysely';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type ITableMetaWhere = (
  eb: ExpressionBuilder<V1TeableDatabase, 'table_meta'>
) => Expression<SqlBool>;

export class TableWhereVisitor extends AbstractSpecFilterVisitor<ITableMetaWhere> {
  constructor() {
    super();
    this.addCond((eb) => eb.eb('deleted_time', 'is', null));
  }

  visit(spec: ISpecification): Result<void, string> {
    if (spec instanceof TableByBaseIdSpec) {
      return this.withBaseId(spec).map(() => undefined);
    }
    if (spec instanceof TableByIdSpec) {
      return this.withId(spec).map(() => undefined);
    }
    if (spec instanceof TableByNameSpec) {
      return this.withName(spec).map(() => undefined);
    }
    if (spec instanceof TableByNameLikeSpec) {
      return this.withNameLike(spec).map(() => undefined);
    }
    return ok(undefined);
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

  private withBaseId(spec: TableByBaseIdSpec): Result<ITableMetaWhere, string> {
    const cond: ITableMetaWhere = (eb) => eb.eb('base_id', '=', spec.baseId().toString());
    return this.addCond(cond).map(() => cond);
  }

  private withId(spec: TableByIdSpec): Result<ITableMetaWhere, string> {
    const cond: ITableMetaWhere = (eb) => eb.eb('id', '=', spec.tableId().toString());
    return this.addCond(cond).map(() => cond);
  }

  private withName(spec: TableByNameSpec): Result<ITableMetaWhere, string> {
    const cond: ITableMetaWhere = (eb) => eb.eb('name', '=', spec.tableName().toString());
    return this.addCond(cond).map(() => cond);
  }

  private withNameLike(spec: TableByNameLikeSpec): Result<ITableMetaWhere, string> {
    const pattern = `%${spec.tableName().toString()}%`;
    const cond: ITableMetaWhere = (eb) => eb.eb('name', 'like', pattern);
    return this.addCond(cond).map(() => cond);
  }
}
