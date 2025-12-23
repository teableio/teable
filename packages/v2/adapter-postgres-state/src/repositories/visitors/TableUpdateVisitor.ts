import {
  type ISpecification,
  type ITableSpecVisitor,
  NotSpec,
  OrSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export type ITableMetaUpdate = {
  name?: string;
};

export class TableUpdateVisitor implements ITableSpecVisitor<ITableMetaUpdate> {
  private readonly updates: ITableMetaUpdate = {};

  visit(spec: ISpecification): Result<void, string> {
    if (spec instanceof OrSpec) return err('OrSpec is not supported for table updates');
    if (spec instanceof NotSpec) return err('NotSpec is not supported for table updates');
    return ok(undefined);
  }

  visitTableByBaseId(_: TableByBaseIdSpec): Result<ITableMetaUpdate, string> {
    return err('TableByBaseIdSpec is not supported for table updates');
  }

  visitTableById(_: TableByIdSpec): Result<ITableMetaUpdate, string> {
    return err('TableByIdSpec is not supported for table updates');
  }

  visitTableByName(spec: TableByNameSpec): Result<ITableMetaUpdate, string> {
    this.updates.name = spec.tableName().toString();
    return ok(this.updates);
  }

  visitTableByNameLike(_: TableByNameLikeSpec): Result<ITableMetaUpdate, string> {
    return err('TableByNameLikeSpec is not supported for table updates');
  }

  update(): Result<ITableMetaUpdate, string> {
    if (Object.keys(this.updates).length === 0) return err('Empty update');
    return ok({ ...this.updates });
  }
}
