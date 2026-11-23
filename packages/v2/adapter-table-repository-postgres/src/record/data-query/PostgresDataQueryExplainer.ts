import {
  domainError,
  getFormulaSourceBudget,
  type DomainError,
  type IExecutionContext,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import {
  DataQueryBinding,
  projectExplainPlanDocument,
  traceDataQueryStage,
  type BoundDataQuery,
  type DataQueryExplainResult,
  type DataQueryRelationPlan,
  type IDataQueryExplainer,
} from '@teable/v2-data-query';
import type {
  FormulaCompileBudgetConfig,
  IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type CompiledQuery, type Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';

type ExplainRow = { 'QUERY PLAN': unknown };
type ExplainStatement = CompiledQuery<Record<string, unknown>>;
type CursorStatementCompiler = (
  normalization: 'sql' | 'driver'
) => Promise<Result<ExplainStatement, DomainError>>;

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
 * Compiles the exhaustive diagnostic equivalent, then asks PostgreSQL to plan it.
 * Conditional cursor execution may use fewer groups or two statements. The business
 * SELECT is never executed here, and its result rows never exist.
 */
export class PostgresDataQueryExplainer implements IDataQueryExplainer {
  private readonly statementTimeoutMs: number;
  private readonly typeValidationStrategy?: IPgTypeValidationStrategy;
  private readonly formulaCompileBudget?: FormulaCompileBudgetConfig;
  private readonly cursorSigningKey?: string;

  constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    options: {
      statementTimeoutMs?: number;
      typeValidationStrategy?: IPgTypeValidationStrategy;
      formulaCompileBudget?: FormulaCompileBudgetConfig;
      cursorSigningKey?: string;
    } = {}
  ) {
    const timeout = options.statementTimeoutMs ?? 4000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60_000) {
      throw new RangeError(
        'Data query statement timeout must be positive and no greater than 60000'
      );
    }
    this.statementTimeoutMs = Math.ceil(timeout);
    this.typeValidationStrategy = options.typeValidationStrategy;
    this.formulaCompileBudget = options.formulaCompileBudget;
    this.cursorSigningKey = options.cursorSigningKey;
  }

  async explain(
    context: IExecutionContext,
    table: Table,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope,
    binding?: DataQueryBinding
  ): Promise<Result<DataQueryExplainResult, DomainError>> {
    const startedAt = performance.now();
    if (query.cursor && !this.cursorSigningKey)
      return err(
        domainError.infrastructure({
          code: 'data_query.cursor_not_configured',
          message: 'Data query cursor signing is not configured',
        })
      );
    // Direct adapter callers have no service binding. Prepare once here so both
    // compilations still use the same live schema and dependency plan.
    const prepared = binding
      ? ok(binding)
      : DataQueryBinding.prepare(query.validatedDefinition, table, {
          formulaSourceBudget: getFormulaSourceBudget(context),
        });
    if (prepared.isErr()) return err(prepared.error);
    const compiler = new PostgresDataQueryExecutor(this.db, {
      statementTimeoutMs: this.statementTimeoutMs,
      typeValidationStrategy: this.typeValidationStrategy,
      formulaCompileBudget: this.formulaCompileBudget,
      cursorSigningKey: this.cursorSigningKey,
    });
    const compile: CursorStatementCompiler = async (normalization) => {
      const full = compiler.compile(
        context,
        table,
        query,
        scope,
        prepared.value,
        scope,
        normalization
      );
      if (full.isErr()) return err(full.error);
      // Public text is caller-authored only. Host policy is summarized, never
      // rendered; cursor authentication still retains the actual scopes.
      return compiler.compile(context, table, query, {}, prepared.value, scope, normalization);
    };
    const caller = query.cursor ? undefined : await compile('sql');
    if (caller?.isErr()) return err(caller.error);
    const planning = await traceDataQueryStage(
      context,
      'explain.plan',
      {
        'teable.component': 'repository',
        'teable.table_id': table.id().toString(),
        'teable.data_query.kind': prepared.value.plan.kind,
      },
      async () => this.plan(caller?.isOk() ? caller.value : compile)
    );
    if (planning.isErr()) return err(planning.error);
    const definitions = prepared.value.plan.parameters.map(({ name, type, nullable }) => ({
      name,
      type,
      nullable,
    }));
    const result: DataQueryExplainResult = {
      sql: planning.value.compiled.sql,
      sqlScope: 'caller',
      hostScope: {
        rowScope: 'applied',
        fieldScope: 'applied',
        fieldMaskCount: scope.fieldMasks ? scope.fieldMasks.length : null,
      },
      parameters: {
        order: definitions.map(({ name }) => name),
        orderKind: 'declaration',
        redaction: 'bind-values-hidden',
        bindCount: planning.value.compiled.parameters.length,
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
    if (plan.query.cursor && !this.cursorSigningKey)
      return err(
        domainError.infrastructure({
          code: 'data_query.cursor_not_configured',
          message: 'Data query cursor signing is not configured',
        })
      );
    const compiler = new PostgresDataQueryExecutor(this.db, {
      statementTimeoutMs: this.statementTimeoutMs,
      typeValidationStrategy: this.typeValidationStrategy,
      formulaCompileBudget: this.formulaCompileBudget,
      cursorSigningKey: this.cursorSigningKey,
    });
    const callerPlan: DataQueryRelationPlan = {
      ...plan,
      rootScope: {},
      sources: plan.sources.map((source) => ({ ...source, scope: {} })),
    };
    const compile: CursorStatementCompiler = async (normalization) => {
      const full = await compiler.compileRelation(context, plan, undefined, normalization);
      if (full.isErr()) return err(full.error);
      // Caller-only SQL retains every authenticated scope in the cursor binding.
      return (
        await compiler.compileRelation(
          context,
          callerPlan,
          plan.query.cursor
            ? new Map([
                ['root', plan.rootScope],
                ...plan.sources.map((source) => [source.alias, source.scope] as const),
              ])
            : undefined,
          normalization
        )
      ).map((queries) => queries.rows);
    };
    const caller = plan.query.cursor ? undefined : await compile('sql');
    if (caller?.isErr()) return err(caller.error);
    const planning = await traceDataQueryStage(
      context,
      'explain.plan',
      {
        'teable.component': 'repository',
        'teable.table_id': plan.rootTable.id().toString(),
        'teable.data_query.kind': plan.plan.kind,
        'teable.data_query.relation_count': plan.sources.length,
      },
      async () => this.plan(caller?.isOk() ? caller.value : compile)
    );
    if (planning.isErr()) return err(planning.error);
    const definitions = plan.plan.parameters.map(({ name, type, nullable }) => ({
      name,
      type,
      nullable,
    }));
    const fieldMaskCount = [plan.rootScope, ...plan.sources.map((source) => source.scope)].reduce(
      (total, scope) => total + (scope.fieldMasks?.length ?? 0),
      0
    );
    const result: DataQueryExplainResult = {
      sql: planning.value.compiled.sql,
      sqlScope: 'caller',
      hostScope: {
        rowScope: 'applied',
        fieldScope: 'applied',
        fieldMaskCount,
      },
      parameters: {
        order: definitions.map(({ name }) => name),
        orderKind: 'declaration',
        redaction: 'bind-values-hidden',
        bindCount: planning.value.compiled.parameters.length,
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
    statement: ExplainStatement | CursorStatementCompiler
  ): Promise<
    Result<
      { compiled: ExplainStatement; plan: DataQueryExplainResult['plan']; planningMs: number },
      DomainError
    >
  > {
    let compiled = typeof statement === 'function' ? undefined : statement;
    try {
      return await this.db.transaction().execute(async (transaction) => {
        await sql`set transaction read only`.execute(transaction);
        await sql`select set_config('statement_timeout', ${String(
          this.statementTimeoutMs
        )}, true)`.execute(transaction);
        const version = await sql<{ version: string; extra_float_digits?: unknown }>`
          select current_setting('server_version_num') as version${typeof statement === 'function' ? sql`, current_setting('extra_float_digits')::integer as extra_float_digits` : sql``}
        `.execute(transaction);
        const supported = Number(version.rows[0]?.version ?? 0) >= GENERIC_PLAN_MIN_VERSION;
        const precision = version.rows[0]?.extra_float_digits;
        const normalization =
          typeof precision === 'number' &&
          Number.isInteger(precision) &&
          precision > 0 &&
          precision <= 3
            ? 'driver'
            : 'sql';
        const selected =
          typeof statement === 'function' ? await statement(normalization) : ok(statement);
        if (selected.isErr()) return err(selected.error);
        const query = selected.value;
        compiled = query;
        // PG16 GENERIC_PLAN uses unresolved $n placeholders through the simple
        // protocol. Sending bound parameters would defeat value independence.
        const explainStartedAt = performance.now();
        let explain: { rows: ExplainRow[] };
        try {
          explain = await transaction.executeQuery<ExplainRow>({
            ...query,
            sql: `explain (format json${supported ? ', generic_plan true' : ''}) ${query.sql}`,
            parameters: supported ? [] : query.parameters,
          });
        } catch (error) {
          if (sqlState(error) === '57014') throw error;
          return ok({
            compiled: query,
            plan: unavailablePlan(),
            planningMs: performance.now() - explainStartedAt,
          });
        }
        const planningMs = performance.now() - explainStartedAt;
        const projected = projectExplainPlanDocument(
          explain?.rows[0]?.['QUERY PLAN'],
          supported ? 'generic' : 'structural'
        );
        // An unavailable document is still a safe diagnostic failure, never a raw plan dump.
        return ok({ compiled: query, plan: projected, planningMs });
      });
    } catch (error) {
      if (sqlState(error) === '57014') return err(timeoutError());
      // Setup failure has no observed precision and no EXPLAIN statement. Keep
      // diagnostic SQL conservative without compiling an unused second variant.
      const fallback = compiled
        ? ok(compiled)
        : typeof statement === 'function'
          ? await statement('sql')
          : ok(statement);
      if (fallback.isErr()) return err(fallback.error);
      return ok({ compiled: fallback.value, plan: unavailablePlan(), planningMs: 0 });
    }
  }
}
