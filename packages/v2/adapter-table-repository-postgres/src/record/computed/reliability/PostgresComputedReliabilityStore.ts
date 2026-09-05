import { computedReliabilityReadinessSql } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';

import type { DynamicDB } from '../../query-builder';

export type ComputedReliabilityIssue = {
  id: string;
  task_id: string;
  base_id: string;
  source_table_id: string;
  error: string;
  failure_kind: string | null;
  failure_phase: string | null;
  error_code: string | null;
  status: string;
  scope_complete: boolean;
  occurrences: number;
  first_seen_at: Date;
  last_seen_at: Date;
};

/** All lifecycle writes use the caller's transaction. Missing migrations leave legacy behavior intact. */
export class PostgresComputedReliabilityStore {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  private table(name: string) {
    // withSchema transforms query table nodes, but not standalone raw fragments.
    // Compile a table query through the caller's plugins and reuse its escaped identifier.
    const query = this.db.selectFrom(name).selectAll().compile().sql;
    return sql.raw(query.slice('select * from '.length));
  }

  async isReady(): Promise<boolean> {
    const result = await sql
      .raw<{
        ready: boolean;
      }>(
        computedReliabilityReadinessSql(
          this.table('computed_reliability_issue').compile(this.db).sql,
          this.table('computed_reliability_scope').compile(this.db).sql
        )
      )
      .execute(this.db);
    return result.rows[0]?.ready === true;
  }

  async recordFailure(input: {
    taskId: string;
    baseId: string;
    sourceTableId: string;
    error: string;
    failureKind?: string;
    failurePhase?: string;
    errorCode?: string;
    targets?: ReadonlyArray<{ tableId: string; fieldId: string }>;
    /** Restrict captured references when only these fields failed in a completed task. */
    fieldIds?: ReadonlyArray<string>;
  }): Promise<void> {
    if (!this.db.isTransaction) {
      await this.db
        .transaction()
        .execute((trx) => new PostgresComputedReliabilityStore(trx).recordFailure(input));
      return;
    }
    const settings = await sql<{
      name: string;
      setting: string;
    }>`select name,setting from pg_settings
      where name in ('lock_timeout','statement_timeout')`.execute(this.db);
    const previous = new Map(settings.rows.map((row) => [row.name, Number(row.setting)]));
    const deadline = Date.now() + 2000;
    const applyBudget = async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Computed reliability evidence write budget exhausted');
      const bounded = (name: string, ceiling: number) => {
        const existing = previous.get(name) ?? 0;
        return String(Math.max(1, Math.min(remaining, ceiling, existing > 0 ? existing : ceiling)));
      };
      await sql`select set_config('lock_timeout', ${bounded('lock_timeout', 250)}, true),
        set_config('statement_timeout', ${bounded('statement_timeout', 2000)}, true)`.execute(
        this.db
      );
    };
    await applyBudget();
    await this.recordFailureInTransaction(input, applyBudget);
    // Errors deliberately propagate: the owner must roll back task and evidence together.
    await sql`select set_config('lock_timeout', ${String(previous.get('lock_timeout') ?? 0)}, true),
      set_config('statement_timeout', ${String(previous.get('statement_timeout') ?? 0)}, true)`.execute(
      this.db
    );
  }

  private async recordFailureInTransaction(
    input: Parameters<PostgresComputedReliabilityStore['recordFailure']>[0],
    applyBudget: () => Promise<void>
  ): Promise<void> {
    if (!(await this.isReady())) return;
    await applyBudget();
    const id = `issue:${input.taskId}`;
    const refs = await sql<{ table_id: string; field_id: string }>`select table_id, field_id
      from ${this.table('computed_task_field_ref')} where task_id = ${input.taskId}`.execute(
      this.db
    );
    const targets = [
      ...refs.rows
        .filter((r) => !input.fieldIds || input.fieldIds.includes(r.field_id))
        .map((r) => ({ tableId: r.table_id, fieldId: r.field_id })),
      ...(input.targets ?? []),
    ];
    await applyBudget();
    await sql`insert into ${this.table('computed_reliability_issue')}(id,task_id,base_id,source_table_id,error,scope_complete,failure_kind,failure_phase,error_code)
      values (${id},${input.taskId},${input.baseId},${input.sourceTableId},${input.error},${targets.length > 0 && (!input.fieldIds || input.fieldIds.every((fieldId) => targets.some((target) => target.fieldId === fieldId)))},${input.failureKind ?? null},${input.failurePhase ?? null},${input.errorCode ?? null})
      on conflict(task_id) do update set error=excluded.error,status='open',
      failure_kind=excluded.failure_kind,failure_phase=excluded.failure_phase,error_code=excluded.error_code,
      occurrences=computed_reliability_issue.occurrences+1,last_seen_at=now(),closed_at=null,
      scope_complete=computed_reliability_issue.scope_complete or excluded.scope_complete`.execute(
      this.db
    );
    const uniqueTargets = [
      ...new Map(targets.map((target) => [`${target.tableId}:${target.fieldId}`, target])).values(),
    ];
    // Bound parameters per statement even for unusually wide dependency graphs.
    for (let offset = 0; offset < uniqueTargets.length; offset += 1000) {
      await applyBudget();
      const batch = uniqueTargets.slice(offset, offset + 1000);
      await sql`insert into ${this.table('computed_reliability_scope')}(issue_id,table_id,field_id)
        values ${sql.join(batch.map((target) => sql`(${id},${target.tableId},${target.fieldId})`))}
        on conflict do nothing`.execute(this.db);
    }
  }

  async getFieldSummaries(tableId: string, alreadyReady = false) {
    if (!alreadyReady && !(await this.isReady())) return [];
    const result = await sql<{
      field_id: string;
      base_id: string;
      unresolved: string;
      oldest: Date;
      scope_complete: boolean;
    }>`select s.field_id,i.base_id,
      count(*) as unresolved,
      min(i.first_seen_at) as oldest,bool_and(i.scope_complete) as scope_complete
      from ${this.table('computed_reliability_issue')} i join ${this.table('computed_reliability_scope')} s on s.issue_id=i.id
      where s.table_id=${tableId} and i.status not in ('resolved','not_applicable')
      group by s.field_id,i.base_id`.execute(this.db);
    return result.rows.map((r) => ({
      fieldId: r.field_id,
      baseId: r.base_id,
      reliability: {
        unresolvedCount: Number(r.unresolved),
        oldestUnresolvedAt: new Date(r.oldest).toISOString(),
        scopeComplete: r.scope_complete,
      },
    }));
  }

  /** Count distinct incidents in SQL; never materialize unbounded issue identity arrays. */
  async getTableSummary(
    tableId: string,
    readableFieldIds?: readonly string[],
    alreadyReady = false
  ) {
    if (!alreadyReady && !(await this.isReady())) return null;
    const fieldPredicate =
      readableFieldIds === undefined
        ? sql`true`
        : readableFieldIds.length
          ? sql`s.field_id in (${sql.join(readableFieldIds)})`
          : sql`false`;
    const unknownCandidates =
      readableFieldIds === undefined
        ? sql`union select u.id from ${this.table('computed_reliability_issue')} u
          where u.source_table_id=${tableId} and u.scope_complete=false
          and not exists(select 1 from ${this.table('computed_reliability_scope')} us where us.issue_id=u.id)`
        : sql``;
    const result = await sql<{
      unresolved: string;
      oldest: Date | null;
      scope_complete: boolean | null;
    }>`
      select count(distinct i.id) as unresolved,min(i.first_seen_at) as oldest,
        bool_and(i.scope_complete) as scope_complete
      from ${this.table('computed_reliability_issue')} i
      join (
        select s.issue_id from ${this.table('computed_reliability_scope')} s
        where s.table_id=${tableId} and ${fieldPredicate}
        ${unknownCandidates}
      ) candidates on candidates.issue_id=i.id
      where i.status not in ('resolved','not_applicable')`.execute(this.db);
    const row = result.rows[0];
    return {
      unresolvedCount: Number(row?.unresolved ?? 0),
      oldestUnresolvedAt: row?.oldest ? new Date(row.oldest).toISOString() : null,
      scopeComplete: row?.scope_complete ?? true,
    };
  }

  async getUnknownScopeSummary(tableId: string, alreadyReady = false) {
    if (!alreadyReady && !(await this.isReady())) return null;
    const result = await sql<{
      unresolved: string;
      oldest: Date | null;
    }>`
      select count(*) as unresolved,min(i.first_seen_at) as oldest
      from ${this.table('computed_reliability_issue')} i where i.source_table_id=${tableId}
      and i.scope_complete=false and i.status not in ('resolved','not_applicable')
      and not exists(select 1 from ${this.table('computed_reliability_scope')} s where s.issue_id=i.id)`.execute(
      this.db
    );
    const row = result.rows[0];
    if (!row || Number(row.unresolved) === 0) return null;
    return {
      unresolvedCount: Number(row.unresolved),
      oldestUnresolvedAt: row.oldest ? new Date(row.oldest).toISOString() : null,
      scopeComplete: false,
    };
  }

  async listIssues(input: { baseId?: string; tableId?: string; limit?: number } = {}) {
    if (!(await this.isReady())) return [];
    const result =
      await sql<ComputedReliabilityIssue>`select i.* from ${this.table('computed_reliability_issue')} i
      where ${input.baseId ? sql`i.base_id=${input.baseId}` : sql`true`}
      and ${input.tableId ? sql`(i.source_table_id=${input.tableId} or exists(select 1 from ${this.table('computed_reliability_scope')} s where s.issue_id=i.id and s.table_id=${input.tableId}))` : sql`true`}
      order by i.first_seen_at desc limit ${Math.min(200, Math.max(1, input.limit ?? 100))}`.execute(
        this.db
      );
    return result.rows;
  }
}
