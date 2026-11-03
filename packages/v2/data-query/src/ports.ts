import type {
  DomainError,
  IExecutionContext,
  RecordQueryPluginScope,
  Table,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type { BoundDataQueryPlan } from './BoundDataQueryPlan';
import type { DataQueryBinding } from './DataQueryBinding';
import type { BoundDataQuery } from './types';

export interface DataQueryResult {
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Present only for `page.includeTotal`; `total` ignores limit/offset. */
  readonly page?: { readonly limit: number; readonly offset: number; readonly total: number };
}

export type DataQueryRelationPlanSource = {
  readonly alias: string;
  readonly table: Table;
  readonly linkFieldId: string;
  readonly scope: RecordQueryPluginScope;
};

/** A bound v2 query plus the independently authorized scopes of every joined table. */
export type DataQueryRelationPlan = {
  readonly query: BoundDataQuery;
  readonly rootTable: Table;
  readonly rootScope: RecordQueryPluginScope;
  readonly sources: ReadonlyArray<DataQueryRelationPlanSource>;
  /** The single semantic source the executor compiles from. */
  readonly plan: BoundDataQueryPlan;
};

/** Executes a bound definition against the current schema and this request's authorization scope. */
export interface IDataQueryExecutor {
  execute(
    context: IExecutionContext,
    table: Table,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope,
    binding?: DataQueryBinding
  ): Promise<Result<DataQueryResult, DomainError>>;
  /** Optional so existing adapters keep the v1 contract; v2 relations require it. */
  executeRelation?(
    context: IExecutionContext,
    plan: DataQueryRelationPlan
  ): Promise<Result<DataQueryResult, DomainError>>;
}
