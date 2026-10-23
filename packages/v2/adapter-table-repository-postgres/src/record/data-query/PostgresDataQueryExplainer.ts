import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  projectExplainPlanDocument,
  traceDataQueryStage,
  type BoundDataQuery,
  type DataQueryExplainResult,
  type DataQueryRelationPlan,
  type IDataQueryExplainer,
} from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type CompiledQuery, type Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

type ExplainRow = { 'QUERY PLAN': unknown };

/** GENERIC_PLAN landed in PostgreSQL 16; older servers only get a structural summary. */
const GENERIC_PLAN_MIN_VERSION = 160000;

/** Same failure class the executor raises, so the host maps one timeout status. */
const timeoutError = (): DomainError =>
  domainError.infrastructure({
    code: 'data_query.timeout',
    message: 'Data query exceeded its statement timeout',
    details: { sqlState: '57014' },
  });

/** SQLSTATE is the only driver detail safe to keep briefly; it never reaches a response. */
const unavailablePlan = (): DataQueryExplainResult['plan'] => ({
  mode: 'unavailable',
  analyzed: false,
  format: 'json',
  scope: 'caller',
});

const sqlState = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : undefined;
};

/**
 * Compiles through the executor's single DSL compiler, then asks PostgreSQL to
 * plan. The business SELECT is never executed, and its result rows never exist.
 */
export class PostgresDataQueryExplainer implements IDataQueryExplainer {
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    options: { statementTimeoutMs?: number } = {}
  ) {
    const timeout = options.statementTimeoutMs ?? 4000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60_000) {
      throw new RangeError(
        'Data query statement timeout must be positive and no greater than 60000'
      );
    }
    this.statementTimeoutMs = Math.ceil(timeout);
  }

  async explain(
    context: IExecutionContext,
    table: Table,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope
  ): Promise<Result<DataQueryExplainResult, DomainError>> {
    const startedAt = performance.now();
    const compiler = new PostgresDataQueryExecutor(this.db, {
      statementTimeoutMs: this.statementTimeoutMs,
    });
    const full = compiler.compile(context, table, query, scope);
    if (full.isErr()) return err(full.error);
    // Public text is caller-authored only. Host row/field policy is summarized,
    // never rendered: compiled predicates can disclose restricted schema policy.
    const caller = compiler.compile(context, table, query, {});
    if (caller.isErr()) return err(caller.error);
    const planning = await traceDataQueryStage(
      context,
      'explain.plan',
      {
        'teable.component': 'repository',
        'teable.table_id': table.id().toString(),
        'teable.data_query.kind': query.definition.kind,
      },
      async () => this.plan(caller.value)
    );
    if (planning.isErr()) return err(planning.error);
    const snapshot = query.definition.parameters ?? {};
    const definitions = Object.entries(snapshot).map(([name, definition]) => ({
      name,
      type: definition.type,
      nullable: definition.nullable === true,
    }));
    const result: DataQueryExplainResult = {
      sql: caller.value.sql,
      sqlScope: 'caller',
      hostScope: {
        rowScope: 'applied',
        fieldScope: 'applied',
        fieldMaskCount: scope.fieldMasks ? scope.fieldMasks.length : null,
      },
      parameters: {
        order: Object.keys(snapshot),
        orderKind: 'declaration',
        redaction: 'bind-values-hidden',
        bindCount: caller.value.parameters.length,
        definitions,
      },
      plan: planning.value.plan,
      timing: {
        planningMs: Math.max(0, Math.round(planning.value.planningMs * 1000) / 1000),
        totalMs: Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000),
      },
    };
    return ok(result);
  }

  async explainRelation(
    context: IExecutionContext,
    plan: DataQueryRelationPlan
  ): Promise<Result<DataQueryExplainResult, DomainError>> {
    const startedAt = performance.now();
    const compiler = new PostgresDataQueryExecutor(this.db, {
      statementTimeoutMs: this.statementTimeoutMs,
    });
    const full = await compiler.compileRelation(context, plan);
    if (full.isErr()) return err(full.error);
    const callerPlan: DataQueryRelationPlan = {
      ...plan,
      rootScope: {},
      sources: plan.sources.map((source) => ({ ...source, scope: {} })),
    };
    const caller = await compiler.compileRelation(context, callerPlan);
    if (caller.isErr()) return err(caller.error);
    const planning = await traceDataQueryStage(
      context,
      'explain.plan',
      {
        'teable.component': 'repository',
        'teable.table_id': plan.rootTable.id().toString(),
        'teable.data_query.kind': plan.query.definition.kind,
        'teable.data_query.relation_count': plan.sources.length,
      },
      async () => this.plan(caller.value.rows)
    );
    if (planning.isErr()) return err(planning.error);
    const snapshot = plan.query.definition.parameters ?? {};
    const definitions = Object.entries(snapshot).map(([name, definition]) => ({
      name,
      type: definition.type,
      nullable: definition.nullable === true,
    }));
    const fieldMaskCount = [plan.rootScope, ...plan.sources.map((source) => source.scope)].reduce(
      (total, scope) => total + (scope.fieldMasks?.length ?? 0),
      0
    );
    const result: DataQueryExplainResult = {
      sql: caller.value.rows.sql,
      sqlScope: 'caller',
      hostScope: {
        rowScope: 'applied',
        fieldScope: 'applied',
        fieldMaskCount,
      },
      parameters: {
        order: Object.keys(snapshot),
        orderKind: 'declaration',
        redaction: 'bind-values-hidden',
        bindCount: caller.value.rows.parameters.length,
        definitions,
      },
      plan: planning.value.plan,
      timing: {
        planningMs: Math.max(0, Math.round(planning.value.planningMs * 1000) / 1000),
        totalMs: Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000),
      },
    };
    return ok(result);
  }
  private async plan(
    compiled: CompiledQuery<Record<string, unknown>>
  ): Promise<Result<{ plan: DataQueryExplainResult['plan']; planningMs: number }, DomainError>> {
    try {
      return await this.db.transaction().execute(async (transaction) => {
        await sql`set transaction read only`.execute(transaction);
        await sql`select set_config('statement_timeout', ${String(
          this.statementTimeoutMs
        )}, true)`.execute(transaction);
        const version = await sql<{ version: string }>`
          select current_setting('server_version_num') as version
        `.execute(transaction);
        const supported = Number(version.rows[0]?.version ?? 0) >= GENERIC_PLAN_MIN_VERSION;
        // PG16 GENERIC_PLAN uses unresolved $n placeholders through the simple
        // protocol. Sending bound parameters would defeat value independence.
        const explainStartedAt = performance.now();
        let explain: { rows: ExplainRow[] };
        try {
          explain = await transaction.executeQuery<ExplainRow>({
            ...compiled,
            sql: `explain (format json${supported ? ', generic_plan true' : ''}) ${compiled.sql}`,
            parameters: supported ? [] : compiled.parameters,
          });
        } catch (error) {
          if (sqlState(error) === '57014') throw error;
          return ok({ plan: unavailablePlan(), planningMs: performance.now() - explainStartedAt });
        }
        const planningMs = performance.now() - explainStartedAt;
        const projected = projectExplainPlanDocument(
          explain?.rows[0]?.['QUERY PLAN'],
          supported ? 'generic' : 'structural'
        );
        // An unavailable document is still a safe diagnostic failure, never a raw plan dump.
        return ok({ plan: projected, planningMs });
      });
    } catch (error) {
      if (sqlState(error) === '57014') return err(timeoutError());
      return ok({ plan: unavailablePlan(), planningMs: 0 });
    }
  }
}
