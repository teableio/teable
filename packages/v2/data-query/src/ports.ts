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

export type DataQueryOffsetPage = {
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  readonly nextCursor?: never;
};
export type DataQueryCursorPage = {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly offset?: never;
  readonly total?: number;
};
export type QueryPage = DataQueryOffsetPage | DataQueryCursorPage;

export interface DataQueryResult {
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Offset totals remain opt-in; V7 always returns its continuation envelope. */
  readonly page?: QueryPage;
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
