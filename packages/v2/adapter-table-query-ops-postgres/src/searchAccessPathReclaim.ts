import { type DomainError, type IExecutionContext } from '@teable/v2-core';
import type {
  TableSearchAccessPathReclaimCandidate,
  TableSearchAccessPathReclaimSource,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { toInfrastructureError } from './helpers';
import type { TableQueryObservationDatabase, TableQueryOpsDatabase } from './schema';
import type { UnknownPostgresDatabase } from './types';

type ReadyConfigRow = {
  readonly config_version: string;
  readonly table_id: string;
  readonly base_id: string;
  readonly candidate_key: string;
  readonly index_name: string;
  readonly reclaim_idx_scan_baseline: number | string | null;
  readonly reclaim_sampled_at: Date | null;
  readonly created_time: Date | null;
  readonly last_modified_time: Date | null;
};

type DueConfigRow = Pick<
  ReadyConfigRow,
  | 'config_version'
  | 'table_id'
  | 'base_id'
  | 'candidate_key'
  | 'created_time'
  | 'last_modified_time'
> & { readonly reclaim_drop_after: Date };

export const calculateIndexScanDelta = (
  baselineIdxScan: number,
  currentIdxScan: number
): number | undefined =>
  currentIdxScan < baselineIdxScan ? undefined : currentIdxScan - baselineIdxScan;

const RECLAIM_DROP_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export const reclaimDropClaimExpiredBefore = (now: Date): Date =>
  new Date(now.getTime() - RECLAIM_DROP_CLAIM_TTL_MS);

/**
 * Supplies reclaim candidates for the analyzer sweep. Index-usage deltas are
 * measured against a baseline persisted in dedicated config columns (owned by
 * this source alone — the inspection JSONB is replaced wholesale by other
 * writers); a delta only becomes known once the baseline is at least idleMs
 * old, so a freshly sampled index can never be reclaimed on partial evidence.
 */
export class PostgresTableSearchAccessPathReclaimSource
  implements TableSearchAccessPathReclaimSource
{
  constructor(
    private readonly opsMetaDb: Kysely<TableQueryOpsDatabase>,
    private readonly observationDb: Kysely<TableQueryObservationDatabase>,
    private readonly dataDb: Kysely<UnknownPostgresDatabase>
  ) {}

  async listCandidates(
    _context: IExecutionContext,
    input: { readonly now: Date; readonly minHoldMs: number; readonly idleMs: number }
  ): Promise<Result<ReadonlyArray<TableSearchAccessPathReclaimCandidate>, DomainError>> {
    try {
      const claimExpiredBefore = reclaimDropClaimExpiredBefore(input.now);
      const [configs, dueConfigs] = await Promise.all([
        sql<ReadyConfigRow>`
        SELECT xmin::text AS config_version,
               table_id, base_id, candidate_key, index_name,
               reclaim_idx_scan_baseline, reclaim_sampled_at,
               created_time, last_modified_time
        FROM table_query_search_vector_config
        WHERE status = 'ready'
      `.execute(this.opsMetaDb as unknown as Kysely<UnknownPostgresDatabase>),
        sql<DueConfigRow>`
        SELECT xmin::text AS config_version,
               table_id, base_id, candidate_key, reclaim_drop_after,
               created_time, last_modified_time
        FROM table_query_search_vector_config
        WHERE status = 'disabled'
          AND reclaim_drop_after <= ${input.now}
          AND (
            reclaim_drop_queued_at IS NULL
            OR reclaim_drop_queued_at <= ${claimExpiredBefore}
          )
      `.execute(this.opsMetaDb as unknown as Kysely<UnknownPostgresDatabase>),
      ]);

      const held = configs.rows.filter((config) => {
        const readyAt = config.last_modified_time ?? config.created_time;
        return readyAt && input.now.getTime() - readyAt.getTime() >= input.minHoldMs;
      });
      const due = dueConfigs.rows.map(
        (config): TableSearchAccessPathReclaimCandidate => ({
          phase: 'drop_due',
          tableId: config.table_id,
          baseId: config.base_id,
          scopeKey: config.candidate_key,
          configVersion: config.config_version,
          accessPathReadyAt: config.created_time ?? config.last_modified_time ?? input.now,
          dropAfter: config.reclaim_drop_after,
        })
      );
      if (!held.length) return ok(due);

      const [activityByTable, idxScanByIndex] = await Promise.all([
        this.readLastSearchActivity(held.map((config) => config.table_id)),
        this.readIndexScans(held.map((config) => config.index_name)),
      ]);

      const candidates: TableSearchAccessPathReclaimCandidate[] = [...due];
      for (const config of held) {
        const readyAt = (config.last_modified_time ?? config.created_time)!;
        const lastSearchActivityAt = activityByTable.get(config.table_id);
        const indexScanEvidence = await this.resolveIndexScanEvidence(
          config,
          idxScanByIndex.get(config.index_name),
          input
        );
        candidates.push({
          phase: 'active',
          tableId: config.table_id,
          baseId: config.base_id,
          scopeKey: config.candidate_key,
          configVersion: indexScanEvidence.configVersion,
          accessPathReadyAt: readyAt,
          ...(lastSearchActivityAt ? { lastSearchActivityAt } : {}),
          ...(indexScanEvidence.delta !== undefined
            ? { indexScanDelta: indexScanEvidence.delta }
            : {}),
        });
      }
      return ok(candidates);
    } catch (error) {
      return err(
        toInfrastructureError(error, 'Failed to list search access path reclaim candidates')
      );
    }
  }

  async beginGrace(
    _context: IExecutionContext,
    input: {
      readonly tableId: string;
      readonly scopeKey: string;
      readonly expectedVersion: string;
      readonly disabledAt: Date;
      readonly dropAfter: Date;
    }
  ): Promise<Result<boolean, DomainError>> {
    try {
      const result = await sql<{ id: string }>`
        UPDATE table_query_search_vector_config
        SET status = 'disabled',
            reclaim_disabled_at = ${input.disabledAt},
            reclaim_drop_after = ${input.dropAfter},
            reclaim_drop_queued_at = NULL,
            last_modified_time = ${input.disabledAt}
        WHERE table_id = ${input.tableId}
          AND candidate_key = ${input.scopeKey}
          AND status = 'ready'
          AND xmin::text = ${input.expectedVersion}
        RETURNING id
      `.execute(this.opsMetaDb as unknown as Kysely<UnknownPostgresDatabase>);
      return ok(result.rows.length === 1);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to begin search access path reclaim grace'));
    }
  }

  async claimDueDrop(
    _context: IExecutionContext,
    input: { readonly tableId: string; readonly scopeKey: string; readonly now: Date }
  ): Promise<Result<boolean, DomainError>> {
    try {
      const claimExpiredBefore = reclaimDropClaimExpiredBefore(input.now);
      const result = await sql<{ id: string }>`
        UPDATE table_query_search_vector_config
        SET reclaim_drop_queued_at = ${input.now},
            last_modified_time = ${input.now}
        WHERE table_id = ${input.tableId}
          AND candidate_key = ${input.scopeKey}
          AND status = 'disabled'
          AND reclaim_drop_after <= ${input.now}
          AND (
            reclaim_drop_queued_at IS NULL
            OR reclaim_drop_queued_at <= ${claimExpiredBefore}
          )
        RETURNING id
      `.execute(this.opsMetaDb as unknown as Kysely<UnknownPostgresDatabase>);
      return ok(result.rows.length === 1);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to claim search access path reclaim drop'));
    }
  }

  async releaseDueDrop(
    _context: IExecutionContext,
    input: { readonly tableId: string; readonly scopeKey: string }
  ): Promise<Result<void, DomainError>> {
    try {
      await sql`
        UPDATE table_query_search_vector_config
        SET reclaim_drop_queued_at = NULL
        WHERE table_id = ${input.tableId}
          AND candidate_key = ${input.scopeKey}
          AND status = 'disabled'
      `.execute(this.opsMetaDb as unknown as Kysely<UnknownPostgresDatabase>);
      return ok(undefined);
    } catch (error) {
      return err(toInfrastructureError(error, 'Failed to release search access path reclaim drop'));
    }
  }

  private async readLastSearchActivity(tableIds: string[]): Promise<Map<string, Date>> {
    const result = await sql<{ table_id: string; last_window_start: Date | null }>`
      SELECT table_id, MAX(window_start) AS last_window_start
      FROM table_query_observation_shard
      WHERE query_kind = 'search'
        AND table_id = ANY(${tableIds})
      GROUP BY table_id
    `.execute(this.observationDb);
    const map = new Map<string, Date>();
    for (const row of result.rows) {
      if (row.last_window_start) map.set(row.table_id, row.last_window_start);
    }
    return map;
  }

  private async readIndexScans(indexNames: string[]): Promise<Map<string, number>> {
    const result = await sql<{ indexrelname: string; idx_scan: number | string | null }>`
      SELECT indexrelname, COALESCE(SUM(idx_scan), 0) AS idx_scan
      FROM pg_stat_user_indexes
      WHERE indexrelname = ANY(${indexNames})
      GROUP BY indexrelname
    `.execute(this.dataDb);
    const map = new Map<string, number>();
    for (const row of result.rows) {
      const value = Number(row.idx_scan);
      if (Number.isFinite(value)) map.set(row.indexrelname, value);
    }
    return map;
  }

  private async resolveIndexScanEvidence(
    config: ReadyConfigRow,
    currentIdxScan: number | undefined,
    input: { readonly now: Date; readonly idleMs: number }
  ): Promise<{ readonly configVersion: string; readonly delta?: number }> {
    if (currentIdxScan === undefined) return { configVersion: config.config_version };

    const baselineScan =
      config.reclaim_idx_scan_baseline === null
        ? undefined
        : Number(config.reclaim_idx_scan_baseline);
    const baselineAt = config.reclaim_sampled_at ?? undefined;
    const hasBaseline = baselineScan !== undefined && Number.isFinite(baselineScan) && baselineAt;
    const baselineIsOldEnough =
      hasBaseline && input.now.getTime() - baselineAt!.getTime() >= input.idleMs;

    // Refresh the baseline whenever it is missing or already consumed; keep a
    // younger baseline untouched so it can age into a usable delta window.
    let configVersion = config.config_version;
    if (!hasBaseline || baselineIsOldEnough) {
      const refreshed = await sql<{ config_version: string }>`
        UPDATE table_query_search_vector_config
        SET reclaim_idx_scan_baseline = ${currentIdxScan},
            reclaim_sampled_at = ${input.now}
        WHERE table_id = ${config.table_id}
          AND candidate_key = ${config.candidate_key}
          AND xmin::text = ${config.config_version}
        RETURNING xmin::text AS config_version
      `.execute(this.opsMetaDb as unknown as Kysely<UnknownPostgresDatabase>);
      const refreshedVersion = refreshed.rows[0]?.config_version;
      if (!refreshedVersion) return { configVersion };
      configVersion = refreshedVersion;
    }

    if (!baselineIsOldEnough) return { configVersion };
    const delta = calculateIndexScanDelta(baselineScan!, currentIdxScan);
    return {
      configVersion,
      ...(delta !== undefined ? { delta } : {}),
    };
  }
}
