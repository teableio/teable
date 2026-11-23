import {
  err,
  ok,
  type DomainError,
  type LinkField,
  type Result,
  type Table,
} from '@teable/v2-core';

import { vcsDomainError } from '../domain/errors';
import type {
  IBaseVcsSnapshot,
  IRecordVcsSnapshot,
  IVcsWorkingDelta,
  IVcsWorkingTableDelta,
} from '../domain/types';

export type VcsRawSqlExecutor = (
  sql: string,
  parameters?: readonly unknown[]
) => Promise<{ readonly rows: readonly Record<string, unknown>[] }>;

export interface IWorkingDirtyEnsureResult {
  readonly newlyAttachedTableIds: readonly string[];
  readonly newlyAttachedLinkSources: ReadonlyArray<{
    readonly tableId: string;
    readonly fkHostTableName: string;
    readonly selfKeyName: string;
    readonly foreignTableId?: string;
    readonly foreignKeyName?: string;
  }>;
}

const SAFE_SQL_IDENT_RE = /^\w+$/;
const SAFE_VCS_ID_RE = /^[\w-]+$/;

function assertSqlIdent(value: string, label: string): string {
  if (!SAFE_SQL_IDENT_RE.test(value)) {
    throw new Error(`Invalid SQL identifier for ${label}: ${value}`);
  }
  return value;
}

function assertVcsId(value: string, label: string): string {
  if (!SAFE_VCS_ID_RE.test(value)) {
    throw new Error(`Invalid VCS identifier for ${label}: ${value}`);
  }
  return value;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parsePhysicalRelation(rawDbTableName: string): {
  readonly schemaName?: string;
  readonly tableName: string;
  readonly regclassArg: string;
  readonly quotedSqlRef: string;
} {
  const parts = rawDbTableName.split('.');
  if (parts.length === 2) {
    const schemaName = assertSqlIdent(parts[0]!, 'schemaName');
    const tableName = assertSqlIdent(parts[1]!, 'tableName');
    return {
      schemaName,
      tableName,
      regclassArg: `"${schemaName}"."${tableName}"`,
      quotedSqlRef: `"${schemaName}"."${tableName}"`,
    };
  }
  if (parts.length === 1) {
    const tableName = assertSqlIdent(parts[0]!, 'tableName');
    return {
      tableName,
      regclassArg: `"${tableName}"`,
      quotedSqlRef: `"${tableName}"`,
    };
  }
  throw new Error(`Unsupported dbTableName format: ${rawDbTableName}`);
}

const TRACKER_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS "public"."__vcs_dirty_state" (
    "base_id" text PRIMARY KEY,
    "initialized" boolean NOT NULL DEFAULT false,
    "updated_at" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS "public"."__vcs_dirty_row" (
    "base_id" text NOT NULL,
    "table_id" text NOT NULL,
    "record_id" text NOT NULL,
    PRIMARY KEY ("base_id", "table_id", "record_id")
  )`,
  `CREATE TABLE IF NOT EXISTS "public"."__vcs_dirty_meta" (
    "base_id" text NOT NULL,
    "table_id" text NOT NULL,
    PRIMARY KEY ("base_id", "table_id")
  )`,
  `CREATE OR REPLACE FUNCTION "__teable_vcs_track_main_row"()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_record_id text;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_record_id := OLD."__id";
    ELSE
      v_record_id := NEW."__id";
    END IF;
    IF v_record_id IS NOT NULL AND v_record_id <> '' THEN
      INSERT INTO "public"."__vcs_dirty_row" ("base_id", "table_id", "record_id")
      VALUES (TG_ARGV[0], TG_ARGV[1], v_record_id)
      ON CONFLICT ("base_id", "table_id", "record_id") DO NOTHING;
    END IF;
    RETURN NULL;
  END;
  $$`,
  `CREATE OR REPLACE FUNCTION "__teable_vcs_track_junction_row"()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_row jsonb;
    v_id_a text;
    v_id_b text;
  BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      v_row := to_jsonb(NEW);
      v_id_a := v_row ->> TG_ARGV[2];
      IF v_id_a IS NOT NULL AND v_id_a <> '' THEN
        INSERT INTO "public"."__vcs_dirty_row" ("base_id", "table_id", "record_id")
        VALUES (TG_ARGV[0], TG_ARGV[1], v_id_a)
        ON CONFLICT ("base_id", "table_id", "record_id") DO NOTHING;
      END IF;
      IF TG_NARGS >= 5 THEN
        v_id_b := v_row ->> TG_ARGV[4];
        IF v_id_b IS NOT NULL AND v_id_b <> '' THEN
          INSERT INTO "public"."__vcs_dirty_row" ("base_id", "table_id", "record_id")
          VALUES (TG_ARGV[0], TG_ARGV[3], v_id_b)
          ON CONFLICT ("base_id", "table_id", "record_id") DO NOTHING;
        END IF;
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
      v_row := to_jsonb(OLD);
      v_id_a := v_row ->> TG_ARGV[2];
      IF v_id_a IS NOT NULL AND v_id_a <> '' THEN
        INSERT INTO "public"."__vcs_dirty_row" ("base_id", "table_id", "record_id")
        VALUES (TG_ARGV[0], TG_ARGV[1], v_id_a)
        ON CONFLICT ("base_id", "table_id", "record_id") DO NOTHING;
      END IF;
      IF TG_NARGS >= 5 THEN
        v_id_b := v_row ->> TG_ARGV[4];
        IF v_id_b IS NOT NULL AND v_id_b <> '' THEN
          INSERT INTO "public"."__vcs_dirty_row" ("base_id", "table_id", "record_id")
          VALUES (TG_ARGV[0], TG_ARGV[3], v_id_b)
          ON CONFLICT ("base_id", "table_id", "record_id") DO NOTHING;
        END IF;
      END IF;
    END IF;

    RETURN NULL;
  END;
  $$`,
  `CREATE OR REPLACE FUNCTION "__teable_vcs_track_table_meta"()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_base_id text;
    v_table_id text;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_base_id := OLD."base_id";
      v_table_id := OLD."id";
    ELSE
      v_base_id := NEW."base_id";
      v_table_id := NEW."id";
    END IF;
    IF v_base_id IS NOT NULL AND v_table_id IS NOT NULL THEN
      INSERT INTO "public"."__vcs_dirty_meta" ("base_id", "table_id")
      VALUES (v_base_id, v_table_id)
      ON CONFLICT ("base_id", "table_id") DO NOTHING;
    END IF;
    RETURN NULL;
  END;
  $$`,
  `CREATE OR REPLACE FUNCTION "__teable_vcs_track_child_meta"()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_table_id text;
    v_base_id text;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_table_id := OLD."table_id";
    ELSE
      v_table_id := NEW."table_id";
    END IF;
    IF v_table_id IS NOT NULL THEN
      SELECT "base_id" INTO v_base_id FROM "public"."table_meta" WHERE "id" = v_table_id LIMIT 1;
      IF v_base_id IS NOT NULL THEN
        INSERT INTO "public"."__vcs_dirty_meta" ("base_id", "table_id")
        VALUES (v_base_id, v_table_id)
        ON CONFLICT ("base_id", "table_id") DO NOTHING;
      END IF;
    END IF;
    RETURN NULL;
  END;
  $$`,
];

export class WorkingDirtyTracker {
  private schemaVerified = false;

  constructor(private readonly queryRaw: VcsRawSqlExecutor) {}

  private async triggerExists(regclassArg: string, triggerName: string): Promise<boolean> {
    const res = await this.queryRaw(
      `SELECT 1 AS ok FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = to_regclass($1) AND tgname = $2 LIMIT 1`,
      [regclassArg, triggerName]
    );
    return res.rows.length > 0;
  }

  private async relationExists(regclassArg: string): Promise<boolean> {
    const res = await this.queryRaw(`SELECT to_regclass($1) IS NOT NULL AS exists`, [regclassArg]);
    return Boolean(res.rows[0]?.exists);
  }

  private async ensureTrackerDdl(): Promise<void> {
    if (this.schemaVerified) return;

    const checkRes = await this.queryRaw(
      `SELECT to_regclass('"public"."__vcs_dirty_state"') AS s,
              to_regclass('"public"."__vcs_dirty_row"') AS r,
              to_regclass('"public"."__vcs_dirty_meta"') AS m`
    );
    const row = checkRes.rows[0];
    const hasTables = Boolean(row?.s && row?.r && row?.m);
    const fnCount = hasTables ? await this.countTrackerFunctions() : 0;

    if (!hasTables || fnCount < 4) {
      for (const stmt of TRACKER_SCHEMA_DDL) {
        await this.queryRaw(stmt);
      }
    }
    this.schemaVerified = true;
  }

  private async countTrackerFunctions(): Promise<number> {
    const fnCheck = await this.queryRaw(
      `SELECT count(*)::int AS cnt FROM pg_proc WHERE proname IN (
        '__teable_vcs_track_main_row',
        '__teable_vcs_track_junction_row',
        '__teable_vcs_track_table_meta',
        '__teable_vcs_track_child_meta'
      )`
    );
    return Number(fnCheck.rows[0]?.cnt ?? 0);
  }

  private async ensureSchemaAndCatalogTriggers(): Promise<void> {
    await this.ensureTrackerDdl();

    const catalogTriggers: ReadonlyArray<{
      readonly regclassArg: string;
      readonly quotedRef: string;
      readonly triggerName: string;
      readonly fnName: string;
    }> = [
      {
        regclassArg: '"public"."table_meta"',
        quotedRef: '"public"."table_meta"',
        triggerName: '__teable_vcs_dirty_table_meta',
        fnName: '"__teable_vcs_track_table_meta"',
      },
      {
        regclassArg: '"public"."field"',
        quotedRef: '"public"."field"',
        triggerName: '__teable_vcs_dirty_field_meta',
        fnName: '"__teable_vcs_track_child_meta"',
      },
      {
        regclassArg: '"public"."view"',
        quotedRef: '"public"."view"',
        triggerName: '__teable_vcs_dirty_view_meta',
        fnName: '"__teable_vcs_track_child_meta"',
      },
    ];

    for (const item of catalogTriggers) {
      if (!(await this.relationExists(item.regclassArg))) continue;
      if (await this.triggerExists(item.regclassArg, item.triggerName)) continue;
      await this.queryRaw(
        `CREATE TRIGGER "${item.triggerName}" AFTER INSERT OR UPDATE OR DELETE ON ${item.quotedRef} FOR EACH ROW EXECUTE FUNCTION ${item.fnName}()`
      );
    }
  }

  private async seedMainTableDirtyState(
    relQuotedSqlRef: string,
    safeBaseId: string,
    tableId: string
  ): Promise<void> {
    await this.queryRaw(
      `INSERT INTO "public"."__vcs_dirty_row" ("base_id", "table_id", "record_id")
       SELECT $1, $2, "__id" FROM ${relQuotedSqlRef}
       ON CONFLICT ("base_id", "table_id", "record_id") DO NOTHING`,
      [safeBaseId, tableId]
    );
    await this.queryRaw(
      `INSERT INTO "public"."__vcs_dirty_meta" ("base_id", "table_id")
       VALUES ($1, $2)
       ON CONFLICT ("base_id", "table_id") DO NOTHING`,
      [safeBaseId, tableId]
    );
  }

  private async ensureMainTableTrigger(params: {
    readonly safeBaseId: string;
    readonly tableId: string;
    readonly selfDbTableName: string;
    readonly seedNewTables?: boolean;
  }): Promise<boolean> {
    const rel = parsePhysicalRelation(params.selfDbTableName);
    if (!(await this.relationExists(rel.regclassArg))) return false;

    const mainTrigger = '__teable_vcs_dirty_main';
    if (await this.triggerExists(rel.regclassArg, mainTrigger)) return false;

    await this.queryRaw(
      `CREATE TRIGGER "${mainTrigger}" AFTER INSERT OR UPDATE OR DELETE ON ${rel.quotedSqlRef} FOR EACH ROW EXECUTE FUNCTION "__teable_vcs_track_main_row"(${quoteLiteral(params.safeBaseId)}, ${quoteLiteral(params.tableId)})`
    );
    if (params.seedNewTables) {
      await this.seedMainTableDirtyState(rel.quotedSqlRef, params.safeBaseId, params.tableId);
    }
    return true;
  }

  private async seedJunctionKeyColumn(
    fkRelQuotedSqlRef: string,
    keyCol: string,
    safeBaseId: string,
    tableId: string
  ): Promise<void> {
    await this.queryRaw(
      `INSERT INTO "public"."__vcs_dirty_row" ("base_id", "table_id", "record_id")
       SELECT $1, $2, "${keyCol}"::text FROM ${fkRelQuotedSqlRef}
       WHERE "${keyCol}" IS NOT NULL
       ON CONFLICT ("base_id", "table_id", "record_id") DO NOTHING`,
      [safeBaseId, tableId]
    );
  }

  private extractExternalLinkConfig(
    field: Table['getFields'] extends () => infer F
      ? F extends readonly (infer U)[]
        ? U
        : never
      : never,
    selfDbTableName: string
  ):
    | {
        readonly triggerName: string;
        readonly fkHostTableName: string;
        readonly selfKeyName: string;
        readonly foreignTableId?: string;
        readonly foreignKeyName?: string;
      }
    | undefined {
    if (field.type().toString() !== 'link') return undefined;
    const fieldId = assertVcsId(field.id().toString(), 'fieldId');
    const cfgRes = (field as unknown as LinkField).configDto();
    if (cfgRes.isErr()) return undefined;
    const cfg = cfgRes.value as {
      fkHostTableName?: string;
      selfKeyName?: string;
      foreignTableId?: string;
      foreignKeyName?: string;
    };
    if (!cfg.fkHostTableName || cfg.fkHostTableName === selfDbTableName || !cfg.selfKeyName) {
      return undefined;
    }
    const triggerName = `__teable_vcs_dirty_junc_${fieldId.replace(/\W/g, '_').slice(0, 38)}`;
    assertSqlIdent(triggerName, 'triggerName');
    return {
      triggerName,
      fkHostTableName: cfg.fkHostTableName,
      selfKeyName: assertSqlIdent(cfg.selfKeyName, 'selfKeyName'),
      ...(cfg.foreignTableId
        ? { foreignTableId: assertVcsId(cfg.foreignTableId, 'foreignTableId') }
        : {}),
      ...(cfg.foreignKeyName
        ? { foreignKeyName: assertSqlIdent(cfg.foreignKeyName, 'foreignKeyName') }
        : {}),
    };
  }

  private async ensureLinkFieldTrigger(params: {
    readonly safeBaseId: string;
    readonly tableId: string;
    readonly selfDbTableName: string;
    readonly field: Table['getFields'] extends () => infer F
      ? F extends readonly (infer U)[]
        ? U
        : never
      : never;
    readonly seedNewTables?: boolean;
  }): Promise<
    | {
        readonly tableId: string;
        readonly fkHostTableName: string;
        readonly selfKeyName: string;
        readonly foreignTableId?: string;
        readonly foreignKeyName?: string;
      }
    | undefined
  > {
    const resolved = this.extractExternalLinkConfig(params.field, params.selfDbTableName);
    if (!resolved) return undefined;

    const fkRel = parsePhysicalRelation(resolved.fkHostTableName);
    if (!(await this.relationExists(fkRel.regclassArg))) return undefined;
    if (await this.triggerExists(fkRel.regclassArg, resolved.triggerName)) return undefined;

    const args =
      resolved.foreignTableId && resolved.foreignKeyName
        ? [
            params.safeBaseId,
            params.tableId,
            resolved.selfKeyName,
            resolved.foreignTableId,
            resolved.foreignKeyName,
          ]
        : [params.safeBaseId, params.tableId, resolved.selfKeyName];

    await this.queryRaw(
      `CREATE TRIGGER "${resolved.triggerName}" AFTER INSERT OR UPDATE OR DELETE ON ${fkRel.quotedSqlRef} FOR EACH ROW EXECUTE FUNCTION "__teable_vcs_track_junction_row"(${args.map(quoteLiteral).join(', ')})`
    );

    if (params.seedNewTables) {
      await this.seedJunctionKeyColumn(
        fkRel.quotedSqlRef,
        resolved.selfKeyName,
        params.safeBaseId,
        params.tableId
      );
      if (resolved.foreignTableId && resolved.foreignKeyName) {
        await this.seedJunctionKeyColumn(
          fkRel.quotedSqlRef,
          resolved.foreignKeyName,
          params.safeBaseId,
          resolved.foreignTableId
        );
      }
    }

    return {
      tableId: params.tableId,
      fkHostTableName: resolved.fkHostTableName,
      selfKeyName: resolved.selfKeyName,
      ...(resolved.foreignTableId ? { foreignTableId: resolved.foreignTableId } : {}),
      ...(resolved.foreignKeyName ? { foreignKeyName: resolved.foreignKeyName } : {}),
    };
  }

  async ensureTriggersForBase(
    baseId: string,
    liveTables: readonly Table[],
    options?: { readonly seedNewTables?: boolean }
  ): Promise<Result<IWorkingDirtyEnsureResult, DomainError>> {
    try {
      const safeBaseId = assertVcsId(baseId, 'baseId');
      await this.ensureSchemaAndCatalogTriggers();

      const newlyAttachedTableIds: string[] = [];
      const newlyAttachedLinkSources: Array<{
        readonly tableId: string;
        readonly fkHostTableName: string;
        readonly selfKeyName: string;
        readonly foreignTableId?: string;
        readonly foreignKeyName?: string;
      }> = [];

      for (const table of liveTables) {
        const tableId = assertVcsId(table.id().toString(), 'tableId');
        const dbTableRes = table.dbTableName().andThen((name) => name.value());
        if (dbTableRes.isErr()) continue;
        const selfDbTableName = dbTableRes.value;

        const attachedMain = await this.ensureMainTableTrigger({
          safeBaseId,
          tableId,
          selfDbTableName,
          seedNewTables: options?.seedNewTables,
        });
        if (attachedMain) newlyAttachedTableIds.push(tableId);

        for (const field of table.getFields()) {
          const attachedLink = await this.ensureLinkFieldTrigger({
            safeBaseId,
            tableId,
            selfDbTableName,
            field,
            seedNewTables: options?.seedNewTables,
          });
          if (attachedLink) newlyAttachedLinkSources.push(attachedLink);
        }
      }

      return ok({ newlyAttachedTableIds, newlyAttachedLinkSources });
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.dirty_tracker_trigger_error',
          message: `Failed to ensure VCS dirty tracking triggers: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  async markWorkingClean(
    baseId: string,
    liveTables: readonly Table[]
  ): Promise<Result<void, DomainError>> {
    try {
      const safeBaseId = assertVcsId(baseId, 'baseId');
      const ensureRes = await this.ensureTriggersForBase(safeBaseId, liveTables, {
        seedNewTables: false,
      });
      if (ensureRes.isErr()) return err(ensureRes.error);

      await this.queryRaw(`DELETE FROM "public"."__vcs_dirty_row" WHERE "base_id" = $1`, [
        safeBaseId,
      ]);
      await this.queryRaw(`DELETE FROM "public"."__vcs_dirty_meta" WHERE "base_id" = $1`, [
        safeBaseId,
      ]);
      await this.queryRaw(
        `INSERT INTO "public"."__vcs_dirty_state" ("base_id", "initialized", "updated_at")
         VALUES ($1, true, now())
         ON CONFLICT ("base_id") DO UPDATE SET "initialized" = true, "updated_at" = now()`,
        [safeBaseId]
      );
      return ok(undefined);
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.dirty_tracker_mark_clean_failed',
          message: `Failed to mark VCS dirty tracker clean: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private async readDirtyTrackingSets(
    safeBaseId: string,
    newlyAttachedTableIds: readonly string[]
  ): Promise<{
    readonly dirtyIdsByTable: Map<string, Set<string>>;
    readonly schemaChangedTableIds: Set<string>;
  }> {
    const dirtyRowRes = await this.queryRaw(
      `SELECT "table_id", "record_id" FROM "public"."__vcs_dirty_row" WHERE "base_id" = $1`,
      [safeBaseId]
    );
    const dirtyMetaRes = await this.queryRaw(
      `SELECT "table_id" FROM "public"."__vcs_dirty_meta" WHERE "base_id" = $1`,
      [safeBaseId]
    );

    const dirtyIdsByTable = new Map<string, Set<string>>();
    for (const row of dirtyRowRes.rows) {
      const tableId = typeof row.table_id === 'string' ? row.table_id : '';
      const recordId = typeof row.record_id === 'string' ? row.record_id : '';
      if (!tableId || !recordId) continue;
      let set = dirtyIdsByTable.get(tableId);
      if (!set) {
        set = new Set();
        dirtyIdsByTable.set(tableId, set);
      }
      set.add(recordId);
    }

    const schemaChangedTableIds = new Set<string>(newlyAttachedTableIds);
    for (const row of dirtyMetaRes.rows) {
      if (typeof row.table_id === 'string' && row.table_id.length > 0) {
        schemaChangedTableIds.add(row.table_id);
      }
    }

    return { dirtyIdsByTable, schemaChangedTableIds };
  }

  private async buildTableDeltaEntry(params: {
    readonly tableId: string;
    readonly dirtyIds: readonly string[];
    readonly schemaChanged: boolean;
    readonly liveTable: Table | undefined;
    readonly fetchTableRecordsByIds: (
      table: Table,
      recordIds: readonly string[]
    ) => Promise<Result<IRecordVcsSnapshot[], DomainError>>;
  }): Promise<Result<IVcsWorkingTableDelta, DomainError>> {
    if (!params.liveTable) {
      return ok({
        tableId: params.tableId,
        schemaChanged: true,
        dirtyRecordIds: params.dirtyIds,
        upsertedRecords: [],
        deletedRecordIds: params.dirtyIds,
      });
    }

    const fetchedRes = await params.fetchTableRecordsByIds(params.liveTable, params.dirtyIds);
    if (fetchedRes.isErr()) return err(fetchedRes.error);

    const foundSet = new Set(fetchedRes.value.map((r) => r.id));
    return ok({
      tableId: params.tableId,
      schemaChanged: params.schemaChanged,
      dirtyRecordIds: params.dirtyIds,
      upsertedRecords: fetchedRes.value,
      deletedRecordIds: params.dirtyIds.filter((id) => !foundSet.has(id)),
    });
  }

  async captureWorkingDelta(params: {
    readonly baseId: string;
    readonly baseName?: string;
    readonly revision?: number;
    readonly liveTables: readonly Table[];
    readonly schemaSnapshot: IBaseVcsSnapshot;
    readonly fetchTableRecordsByIds: (
      table: Table,
      recordIds: readonly string[]
    ) => Promise<Result<IRecordVcsSnapshot[], DomainError>>;
  }): Promise<Result<IVcsWorkingDelta, DomainError>> {
    try {
      const safeBaseId = assertVcsId(params.baseId, 'baseId');
      await this.ensureSchemaAndCatalogTriggers();

      const stateRes = await this.queryRaw(
        `SELECT "initialized" FROM "public"."__vcs_dirty_state" WHERE "base_id" = $1 LIMIT 1`,
        [safeBaseId]
      );
      if (!stateRes.rows[0]?.initialized) {
        return ok({
          isCompleteDelta: false,
          schemaSnapshot: params.schemaSnapshot,
          tableDeltas: new Map(),
        });
      }

      const ensureRes = await this.ensureTriggersForBase(safeBaseId, params.liveTables, {
        seedNewTables: true,
      });
      if (ensureRes.isErr()) return err(ensureRes.error);

      const { dirtyIdsByTable, schemaChangedTableIds } = await this.readDirtyTrackingSets(
        safeBaseId,
        ensureRes.value.newlyAttachedTableIds
      );
      const liveTableMap = new Map<string, Table>(
        params.liveTables.map((t) => [t.id().toString(), t])
      );
      const tableDeltas = new Map<string, IVcsWorkingTableDelta>();
      const upsertsByTable = new Map<string, IRecordVcsSnapshot[]>();
      const allTouchedTableIds = new Set<string>([
        ...dirtyIdsByTable.keys(),
        ...schemaChangedTableIds,
      ]);

      for (const tableId of Array.from(allTouchedTableIds).sort()) {
        const entryRes = await this.buildTableDeltaEntry({
          tableId,
          dirtyIds: Array.from(dirtyIdsByTable.get(tableId) ?? []).sort(),
          schemaChanged: schemaChangedTableIds.has(tableId),
          liveTable: liveTableMap.get(tableId),
          fetchTableRecordsByIds: params.fetchTableRecordsByIds,
        });
        if (entryRes.isErr()) return err(entryRes.error);
        tableDeltas.set(tableId, entryRes.value);
        if (entryRes.value.upsertedRecords.length > 0) {
          upsertsByTable.set(tableId, [...entryRes.value.upsertedRecords]);
        }
      }

      const enrichedSchemaSnapshot: IBaseVcsSnapshot = {
        ...params.schemaSnapshot,
        tables: params.schemaSnapshot.tables.map((t) => ({
          ...t,
          records: upsertsByTable.get(t.id) ?? t.records,
        })),
      };

      return ok({ isCompleteDelta: true, schemaSnapshot: enrichedSchemaSnapshot, tableDeltas });
    } catch (error) {
      return err(
        vcsDomainError.infrastructure({
          code: 'vcs.dirty_tracker_capture_failed',
          message: `Failed to capture VCS working delta: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }
}
