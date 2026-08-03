import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { Expression, SqlBool } from 'kysely';

import type {
  DomainError,
  ISpecification,
  ITableRecordConditionSpecVisitor,
  TableRecord,
} from '@teable/v2-core';

import {
  TableRecordConditionWhereVisitor,
  type TableRecordConditionWhereVisitorOptions,
} from '../visitors';

const EMPTY_WHERE_ERROR = 'Empty where condition';

export const buildRecordWhereClause = (
  spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
  options?: TableRecordConditionWhereVisitorOptions
): Result<Expression<SqlBool> | null, DomainError> => {
  const visitor = new TableRecordConditionWhereVisitor(options);
  const acceptResult = spec.accept(visitor);
  if (acceptResult.isErr()) {
    return err(acceptResult.error);
  }
  const whereResult = visitor.where();
  if (whereResult.isErr()) {
    if (
      whereResult.error.code === 'validation.invalid' &&
      whereResult.error.message === EMPTY_WHERE_ERROR
    ) {
      return ok(null);
    }
    return err(whereResult.error);
  }
  return ok(whereResult.value as unknown as Expression<SqlBool>);
};
