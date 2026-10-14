import { Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions, ILookupOptionsVo } from '@teable/core';
import { FieldType, IdPrefix } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import type { IMoveBaseNodeCrossBaseLink } from '@teable/openapi';
import { PluginPosition, TableTrashType } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { type IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IDataPrismaQueryExecutor } from '../../global/database-router.service';
import { DatabaseRouter } from '../../global/database-router.service';
import { RawOpType } from '../../share-db/interface';
import { BatchService } from '../calculation/batch.service';
import { TableMutationCacheInvalidator } from './open-api/table-mutation-cache-invalidator';
import { TableService } from './table.service';

type IMovedTable = {
  id: string;
  name: string;
  version: number;
  oldDbTableName: string;
  newDbTableName: string;
};

type IRenamedRelation = { oldName: string; newName: string };

/**
 * Everything a same-space, same-data-database table move needs, computed up
 * front so the physical and the metadata phases agree on the same names.
 */
export type ITableMovePlan = {
  sourceBaseId: string;
  targetBaseId: string;
  tables: IMovedTable[];
  /** junction tables hosted by link fields on the moved tables */
  junctions: IRenamedRelation[];
  sourceReadonlyRole?: string;
  targetReadonlyRole?: string;
};

type IFieldRefRow = {
  id: string;
  tableId: string;
  options: string | null;
  lookupOptions: string | null;
};

/** Before/after of every field row this move rewrote, keyed by field id. */
type IFieldChange = {
  tableId: string;
  options?: { before: string | null; after: string };
  lookupOptions?: { before: string | null; after: string };
};
type IFieldChanges = Map<string, IFieldChange>;

const COMPUTED_STATUS_PENDING = ['pending', 'processing'];

/**
 * Moves tables between two projects of the same space.
 *
 * Physical tables live in a per-project Postgres schema (`${baseId}.${name}`),
 * so a move is `ALTER TABLE ... SET SCHEMA` plus a rewrite of every persisted
 * string that embeds the old schema-qualified name (link/lookup
 * `fkHostTableName`, the undo log) and of every `base_id` column that scopes
 * per-table runtime state on the data database (computed outbox, query
 * observation). Link semantics follow `prepareLinkField`: `options.baseId` is
 * present exactly when the two ends live in different projects.
 *
 * The physical phase runs first in its own data-database transaction, the
 * metadata phase inside the caller's transaction; on a metadata failure the
 * caller rolls the physical phase back (same shape as `updateDbTableName`).
 */
@Injectable()
export class TableMoveService {
  private readonly logger = new Logger(TableMoveService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly tableService: TableService,
    private readonly batchService: BatchService,
    private readonly tableMutationCacheInvalidator: TableMutationCacheInvalidator,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  // ---------------------------------------------------------------------------
  // preview
  // ---------------------------------------------------------------------------

  /**
   * Link-family fields whose two ends share a project today and will not after
   * the move: the other end is always a table staying in the source project.
   * Links that already span projects are left out — the move changes nothing
   * about them.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async collectCrossBaseLinks(
    sourceBaseId: string,
    tableIds: string[]
  ): Promise<IMoveBaseNodeCrossBaseLink[]> {
    if (tableIds.length === 0) return [];
    const moved = new Set(tableIds);
    const prisma = this.prismaService.txClient();
    const result: IMoveBaseNodeCrossBaseLink[] = [];

    const outgoing = await prisma.field.findMany({
      where: { tableId: { in: tableIds }, deletedTime: null },
      select: {
        id: true,
        name: true,
        type: true,
        tableId: true,
        options: true,
        lookupOptions: true,
      },
    });
    const foreignIds = new Set<string>();
    const outgoingRefs = outgoing
      .map((f) => ({ field: f, foreignTableId: this.readForeignTableId(f) }))
      .filter((r): r is typeof r & { foreignTableId: string } => Boolean(r.foreignTableId));
    outgoingRefs.forEach((r) => foreignIds.add(r.foreignTableId));

    const incomingRows = await this.findFieldsReferencingTables(tableIds);
    incomingRows.forEach((r) => foreignIds.add(r.tableId));

    const tables = await prisma.tableMeta.findMany({
      where: { id: { in: [...foreignIds, ...tableIds] }, deletedTime: null },
      select: { id: true, name: true, baseId: true },
    });
    const tableMap = new Map(tables.map((t) => [t.id, t]));

    for (const { field, foreignTableId } of outgoingRefs) {
      if (moved.has(foreignTableId)) continue;
      const foreign = tableMap.get(foreignTableId);
      const self = tableMap.get(field.tableId);
      if (!foreign || !self) continue;
      if (foreign.baseId !== sourceBaseId) continue;
      result.push({
        tableId: self.id,
        tableName: self.name,
        fieldId: field.id,
        fieldName: field.name,
        type: field.type,
        foreignTableId: foreign.id,
        foreignTableName: foreign.name,
        direction: 'outgoing',
      });
    }

    for (const row of incomingRows) {
      if (moved.has(row.tableId)) continue;
      const self = tableMap.get(row.tableId);
      const foreignTableId = this.readForeignTableId(row);
      const foreign = foreignTableId ? tableMap.get(foreignTableId) : undefined;
      if (!self || !foreign) continue;
      if (self.baseId !== sourceBaseId) continue;
      result.push({
        tableId: self.id,
        tableName: self.name,
        fieldId: row.id,
        fieldName: row.name,
        type: row.type,
        foreignTableId: foreign.id,
        foreignTableName: foreign.name,
        direction: 'incoming',
      });
    }

    return result;
  }

  /**
   * Computed-field work still queued for these tables. The worker stamps the
   * project id it was enqueued with on every event it emits, so a move must
   * wait for the queue to drain rather than race it.
   */
  async countPendingComputedTasks(sourceBaseId: string, tableIds: string[]): Promise<number> {
    if (tableIds.length === 0) return 0;
    try {
      const rows = await this.databaseRouter.queryDataPrismaForBase<{ count: number | bigint }[]>(
        sourceBaseId,
        `select count(*)::int as count from "computed_update_outbox"
         where "base_id" = $1 and "status" = any($2::text[])
           and ("seed_table_id" = any($3::text[]) or "affected_table_ids" && $3::text[])`,
        sourceBaseId,
        COMPUTED_STATUS_PENDING,
        tableIds
      );
      return Number(rows[0]?.count ?? 0);
    } catch (error) {
      // A data database without the computed ledger has nothing queued.
      this.logger.warn(
        `[move-node] skip computed outbox check for base ${sourceBaseId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // plan
  // ---------------------------------------------------------------------------

  async prepareMove(
    sourceBaseId: string,
    targetBaseId: string,
    tableIds: string[]
  ): Promise<ITableMovePlan> {
    const prisma = this.prismaService.txClient();
    const rows = await prisma.tableMeta.findMany({
      where: { id: { in: tableIds }, baseId: sourceBaseId, deletedTime: null },
      select: { id: true, name: true, version: true, dbTableName: true },
    });
    const tables: IMovedTable[] = rows.map((row) => {
      const [, tableName] = this.dbProvider.splitTableName(row.dbTableName);
      return {
        id: row.id,
        name: row.name,
        version: row.version,
        oldDbTableName: row.dbTableName,
        newDbTableName: this.dbProvider.joinDbTableName(targetBaseId, tableName),
      };
    });

    // A junction is hosted by the field that created it (`junction_${fieldId}...`),
    // so it follows that field's table.
    const linkFields = await prisma.field.findMany({
      where: {
        tableId: { in: tableIds },
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, options: true },
    });
    const junctionMap = new Map<string, IRenamedRelation>();
    for (const field of linkFields) {
      const options = this.parseJson<ILinkFieldOptions>(field.options);
      const host = options?.fkHostTableName;
      if (!host) continue;
      const [schema, name] = this.dbProvider.splitTableName(host);
      if (schema !== sourceBaseId || !name.startsWith(`junction_${field.id}`)) continue;
      junctionMap.set(host, {
        oldName: host,
        newName: this.dbProvider.joinDbTableName(targetBaseId, name),
      });
    }

    const bases = await prisma.base.findMany({
      where: { id: { in: [sourceBaseId, targetBaseId] } },
      select: { id: true, schemaPass: true },
    });
    const roleFor = (baseId: string) =>
      bases.find((b) => b.id === baseId)?.schemaPass ? `read_only_role_${baseId}` : undefined;

    return {
      sourceBaseId,
      targetBaseId,
      tables,
      junctions: [...junctionMap.values()],
      sourceReadonlyRole: roleFor(sourceBaseId),
      targetReadonlyRole: roleFor(targetBaseId),
    };
  }

  // ---------------------------------------------------------------------------
  // physical phase (data database)
  // ---------------------------------------------------------------------------

  async applyPhysicalMove(plan: ITableMovePlan): Promise<void> {
    await this.runPhysical(plan, 'forward');
  }

  /** Best effort: logs instead of throwing so the original error surfaces. */
  async rollbackPhysicalMove(plan: ITableMovePlan): Promise<void> {
    try {
      await this.runPhysical(plan, 'backward');
    } catch (error) {
      this.logger.error(
        `[move-node] failed to roll back physical table move ${plan.sourceBaseId} -> ${
          plan.targetBaseId
        }: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async runPhysical(plan: ITableMovePlan, direction: 'forward' | 'backward') {
    if (plan.tables.length === 0) return;
    const from = direction === 'forward' ? plan.sourceBaseId : plan.targetBaseId;
    const to = direction === 'forward' ? plan.targetBaseId : plan.sourceBaseId;
    const relations = [
      ...plan.tables.map((t) => ({ oldName: t.oldDbTableName, newName: t.newDbTableName })),
      ...plan.junctions,
    ].map((r) => (direction === 'forward' ? r : { oldName: r.newName, newName: r.oldName }));
    const grantRole = direction === 'forward' ? plan.targetReadonlyRole : plan.sourceReadonlyRole;
    const revokeRole = direction === 'forward' ? plan.sourceReadonlyRole : plan.targetReadonlyRole;
    const tableIds = plan.tables.map((t) => t.id);

    await this.databaseRouter.dataPrismaTransactionForBase(
      plan.sourceBaseId,
      async (prisma) => {
        for (const { oldName, newName } of relations) {
          await prisma.$executeRawUnsafe(this.dbProvider.setTableSchema(oldName, newName));
        }

        const roleExists = async (role: string) => {
          const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
            'select exists(select 1 from pg_roles where rolname = $1) as "exists"',
            role
          );
          return Boolean(rows[0]?.exists);
        };
        // `ALTER DEFAULT PRIVILEGES` only covers tables created in the schema;
        // a relocated table keeps its ACL, so grant/revoke explicitly.
        if (grantRole && (await roleExists(grantRole))) {
          for (const { newName } of relations) {
            const [schema, name] = this.dbProvider.splitTableName(newName);
            await prisma.$executeRawUnsafe(
              this.knex.raw('GRANT SELECT ON ??.?? TO ??', [schema, name, grantRole]).toQuery()
            );
          }
        }
        if (revokeRole && (await roleExists(revokeRole))) {
          for (const { newName } of relations) {
            const [schema, name] = this.dbProvider.splitTableName(newName);
            await prisma.$executeRawUnsafe(
              this.knex
                .raw('REVOKE ALL PRIVILEGES ON ??.?? FROM ??', [schema, name, revokeRole])
                .toQuery()
            );
          }
        }

        const relationExists = async (name: string) => {
          const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
            'select to_regclass($1::text) is not null as "exists"',
            `"${name}"`
          );
          return Boolean(rows[0]?.exists);
        };
        const rebase = async (table: string, tableColumn: string) => {
          if (!(await relationExists(table))) return;
          await prisma.$executeRawUnsafe(
            `update "${table}" set "base_id" = $1 where "base_id" = $2 and "${tableColumn}" = any($3::text[])`,
            to,
            from,
            tableIds
          );
        };
        await rebase('computed_update_outbox', 'seed_table_id');
        await rebase('computed_update_dead_letter', 'seed_table_id');
        await rebase('computed_update_run_history', 'seed_table_id');
        await rebase('computed_task_field_ref', 'table_id');
        await rebase('computed_field_activity', 'table_id');
        await rebase('computed_table_activity', 'table_id');
        await rebase('table_query_observation_shard', 'table_id');
        await rebase('table_query_search_vector_config', 'table_id');

        if (await relationExists('__undo_log')) {
          for (const { oldName, newName } of relations) {
            await prisma.$executeRawUnsafe(
              `update "__undo_log" set "table_name" = $1 where "table_name" = $2`,
              newName,
              oldName
            );
          }
        }
        await this.rewriteTrashSnapshots(prisma, tableIds, from, to, relations);
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }

  /**
   * A field deleted on its own lives on as a snapshot of its definition in
   * the data database's trash, and a restore rebuilds it from there (v1 through
   * createFields, v2 through its own command) — neither reads the field row
   * this move rewrote. So the snapshot gets the same treatment as the row:
   * the cross-project marker recomputed for both ends, the physical names
   * renamed. The trash of every table that names a moved table is read, not
   * only the moved tables' own.
   */
  private async rewriteTrashSnapshots(
    prisma: IDataPrismaQueryExecutor,
    tableIds: string[],
    from: string,
    to: string,
    relations: IRenamedRelation[]
  ) {
    const moved = new Set(tableIds);
    const present = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `select to_regclass('"table_trash"') is not null as "exists"`
    );
    if (!present[0]?.exists) return;
    const rows = await prisma.$queryRawUnsafe<{ id: string; tableId: string; snapshot: string }[]>(
      `select "id", "table_id" as "tableId", "snapshot" from "table_trash"
       where "resource_type" = $1 and ("table_id" = any($2::text[]) or "snapshot" like any($3::text[]))`,
      TableTrashType.Field,
      tableIds,
      tableIds.map((id) => `%${id}%`)
    );
    if (rows.length === 0) return;
    const hostIds = [...new Set(rows.map((r) => r.tableId))].filter((id) => !moved.has(id));
    const hosts = hostIds.length
      ? await this.prismaService.txClient().tableMeta.findMany({
          where: { id: { in: hostIds } },
          select: { id: true, baseId: true },
        })
      : [];
    const hostBaseOf = new Map(hosts.map((t) => [t.id, t.baseId]));
    const renamed = new Map(relations.map((r) => [r.oldName, r.newName]));

    const rebase = (target: Record<string, unknown>, hostBefore: string, hostAfter: string) => {
      let next: Record<string, unknown> = target;
      const host =
        typeof next.fkHostTableName === 'string' ? renamed.get(next.fkHostTableName) : undefined;
      if (host) next = { ...next, fkHostTableName: host };
      if (typeof next.foreignTableId === 'string') {
        const explicit = typeof next.baseId === 'string' ? next.baseId : undefined;
        const foreignBase = moved.has(next.foreignTableId) ? to : explicit ?? hostBefore;
        next = this.withRebasedMarker(next, hostAfter, foreignBase) ?? next;
      }
      return next;
    };

    for (const row of rows) {
      const snapshot = this.parseJson<{ fields?: Record<string, unknown>[] }>(row.snapshot);
      if (!snapshot || !Array.isArray(snapshot.fields)) continue;
      const hostBefore = moved.has(row.tableId) ? from : hostBaseOf.get(row.tableId) ?? from;
      const hostAfter = moved.has(row.tableId) ? to : hostBefore;
      let changed = false;
      const fields = snapshot.fields.map((field) => {
        let next = field;
        for (const key of ['options', 'lookupOptions'] as const) {
          const value = next[key];
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const rebased = rebase(value as Record<string, unknown>, hostBefore, hostAfter);
          if (rebased !== value) {
            next = { ...next, [key]: rebased };
            changed = true;
          }
        }
        return next;
      });
      if (!changed) continue;
      await prisma.$executeRawUnsafe(
        `update "table_trash" set "snapshot" = $1 where "id" = $2`,
        JSON.stringify({ ...snapshot, fields }),
        row.id
      );
    }
  }

  // ---------------------------------------------------------------------------
  // metadata phase (caller's transaction)
  // ---------------------------------------------------------------------------

  async applyMetaMove(plan: ITableMovePlan): Promise<void> {
    if (plan.tables.length === 0) return;
    const prisma = this.prismaService.txClient();
    const { sourceBaseId, targetBaseId } = plan;
    const tableIds = plan.tables.map((t) => t.id);

    // 1. schema-qualified names embedded in link / lookup options
    const changes: IFieldChanges = new Map();
    const renames = [
      ...plan.tables.map((t) => ({ oldName: t.oldDbTableName, newName: t.newDbTableName })),
      ...plan.junctions,
    ];
    for (const { oldName, newName } of renames) {
      await this.rewriteFkHostTableName(oldName, newName, changes);
    }

    // 2. cross-project markers on both ends of every affected reference
    await this.rebaseForeignReferences(plan, tableIds, changes);

    // 2b. tell every open client about the rewritten field options (the tables
    // that stay behind keep their subscriptions, so they only learn it from ops)
    await this.publishFieldChanges(changes);

    // 2c. table-level plugin installs are scoped by project
    await this.movePluginInstalls(plan, tableIds);

    // 3. table rows + ShareDB docs: gone from the old project, born in the new one
    for (const table of plan.tables) {
      await this.batchService.saveRawOps(sourceBaseId, RawOpType.Del, IdPrefix.Table, [
        { docId: table.id, version: table.version },
      ]);
      await prisma.tableMeta.update({
        where: { id: table.id },
        data: {
          baseId: targetBaseId,
          dbTableName: table.newDbTableName,
          // the search index snapshot names the old schema; the serving layer
          // re-publishes it lazily for the new one
          searchIndex: Prisma.DbNull,
          version: table.version + 2,
          lastModifiedTime: new Date().toISOString(),
        },
      });
      const tableVo = await this.tableService.getTableMeta(targetBaseId, table.id);
      const { provisionState: _provisionState, ...tableData } = tableVo as typeof tableVo & {
        provisionState?: unknown;
      };
      await this.batchService.saveRawOps(targetBaseId, RawOpType.Create, IdPrefix.Table, [
        { docId: table.id, version: table.version + 1, data: tableData },
      ]);
    }

    // 4. schema-operation ledger is scoped by project
    await prisma.schemaOperation.updateMany({
      where: { tableId: { in: tableIds }, baseId: sourceBaseId },
      data: { baseId: targetBaseId },
    });
  }

  /** Caches keyed by the old physical name; call after the transaction commits. */
  async afterMoveCommitted(plan: ITableMovePlan): Promise<void> {
    const names = [
      ...plan.tables.map((t) => t.oldDbTableName),
      ...plan.junctions.map((j) => j.oldName),
    ];
    for (const name of names) {
      try {
        await this.tableMutationCacheInvalidator.invalidateDroppedTable(name);
      } catch (error) {
        this.logger.warn(
          `[move-node] cache invalidation failed for ${name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  /**
   * Trashed fields are rewritten too: a table restored from the trash comes
   * back with its link fields exactly as stored, and a field restored on its
   * own is re-created from its stored options, so both would otherwise wake
   * up naming a physical table that no longer exists.
   */
  private async rewriteFkHostTableName(oldName: string, newName: string, changes: IFieldChanges) {
    const linkRows = await this.findFieldsByOptionValue('options', 'fkHostTableName', oldName);
    for (const row of linkRows) {
      const options = this.parseJson<ILinkFieldOptions>(row.options) ?? ({} as ILinkFieldOptions);
      await this.writeField(changes, row.id, row.tableId, {
        options: {
          before: row.options,
          after: JSON.stringify({ ...options, fkHostTableName: newName }),
        },
      });
    }
    const lookupRows = await this.findFieldsByOptionValue(
      'lookup_options',
      'fkHostTableName',
      oldName
    );
    for (const row of lookupRows) {
      const lookupOptions = this.parseJson<ILookupOptionsVo>(row.lookupOptions);
      if (!lookupOptions || !('fkHostTableName' in lookupOptions)) continue;
      await this.writeField(changes, row.id, row.tableId, {
        lookupOptions: {
          before: row.lookupOptions,
          after: JSON.stringify({ ...lookupOptions, fkHostTableName: newName }),
        },
      });
    }
  }

  /** Persists one field rewrite and remembers the earliest "before" for the op diff. */
  private async writeField(
    changes: IFieldChanges,
    fieldId: string,
    tableId: string,
    data: Pick<IFieldChange, 'options' | 'lookupOptions'>
  ) {
    await this.prismaService.txClient().field.update({
      where: { id: fieldId },
      data: {
        ...(data.options ? { options: data.options.after } : {}),
        ...(data.lookupOptions ? { lookupOptions: data.lookupOptions.after } : {}),
      },
    });
    const change = changes.get(fieldId) ?? { tableId };
    for (const key of ['options', 'lookupOptions'] as const) {
      const next = data[key];
      if (!next) continue;
      const prev = change[key];
      change[key] = { before: prev ? prev.before : next.before, after: next.after };
    }
    changes.set(fieldId, change);
  }

  /**
   * One json0 op per rewritten property, versioned like any field edit, so
   * subscribed clients swap the options in place instead of serving stale
   * cross-project markers until the next reload.
   */
  private async publishFieldChanges(changes: IFieldChanges) {
    if (changes.size === 0) return;
    const prisma = this.prismaService.txClient();
    // a trashed field has no live document to patch; its row was updated in place
    const rows = await prisma.field.findMany({
      where: { id: { in: [...changes.keys()] }, deletedTime: null },
      select: { id: true, tableId: true, version: true },
    });
    const byTable = new Map<string, { docId: string; version: number; data: unknown }[]>();
    for (const row of rows) {
      const change = changes.get(row.id);
      if (!change) continue;
      const ops = (['options', 'lookupOptions'] as const)
        .map((key) => {
          const diff = change[key];
          if (!diff || diff.before === diff.after) return undefined;
          const oldValue = this.parseJson<unknown>(diff.before);
          const newValue = this.parseJson<unknown>(diff.after);
          return {
            p: [key],
            ...(newValue == null ? {} : { oi: newValue }),
            ...(oldValue == null ? {} : { od: oldValue }),
          };
        })
        .filter((op): op is NonNullable<typeof op> => Boolean(op));
      if (ops.length === 0) continue;
      await prisma.field.update({
        where: { id: row.id },
        data: { version: row.version + 1 },
      });
      const list = byTable.get(row.tableId) ?? [];
      list.push({ docId: row.id, version: row.version, data: ops });
      byTable.set(row.tableId, list);
    }
    for (const [tableId, dataList] of byTable) {
      await this.batchService.saveRawOps(tableId, RawOpType.Edit, IdPrefix.Field, dataList);
    }
  }

  /**
   * Plugin views, panels and context-menu plugins are installed per table, but
   * their install rows are scoped by project (that is where the plugin token
   * comes from). Returns nothing; the caller re-homes the plugin identities.
   */
  private async movePluginInstalls(plan: ITableMovePlan, tableIds: string[]) {
    const prisma = this.prismaService.txClient();
    const views = await prisma.view.findMany({
      where: { tableId: { in: tableIds } },
      select: { id: true },
    });
    if (views.length > 0) {
      await prisma.pluginInstall.updateMany({
        where: {
          positionId: { in: views.map((v) => v.id) },
          position: PluginPosition.View,
          baseId: plan.sourceBaseId,
        },
        data: { baseId: plan.targetBaseId },
      });
    }
    const panels = await prisma.pluginPanel.findMany({
      where: { tableId: { in: tableIds } },
      select: { id: true },
    });
    if (panels.length > 0) {
      await prisma.pluginInstall.updateMany({
        where: { positionId: { in: panels.map((p) => p.id) }, baseId: plan.sourceBaseId },
        data: { baseId: plan.targetBaseId },
      });
    }
    const menus = await prisma.pluginContextMenu.findMany({
      where: { tableId: { in: tableIds } },
      select: { pluginInstallId: true },
    });
    if (menus.length > 0) {
      await prisma.pluginInstall.updateMany({
        where: { id: { in: menus.map((m) => m.pluginInstallId) }, baseId: plan.sourceBaseId },
        data: { baseId: plan.targetBaseId },
      });
    }
  }

  /**
   * `baseId` on link / lookup / conditional options is present exactly when
   * the field's table and its foreign table live in different projects.
   * Recompute it for every field on a moved table and every field elsewhere
   * that targets a moved table.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async rebaseForeignReferences(
    plan: ITableMovePlan,
    tableIds: string[],
    changes: IFieldChanges
  ) {
    const prisma = this.prismaService.txClient();
    const moved = new Set(tableIds);

    // trashed fields included, for the same reason as in rewriteFkHostTableName
    const own = await prisma.field.findMany({
      where: { tableId: { in: tableIds } },
      select: { id: true, tableId: true, options: true, lookupOptions: true },
    });
    const incoming = await this.findFieldsReferencingTables(tableIds, { includeTrashed: true });
    const candidates = new Map<string, IFieldRefRow>();
    [...own, ...incoming].forEach((row) => candidates.set(row.id, row));

    const involvedTableIds = new Set<string>();
    for (const row of candidates.values()) {
      involvedTableIds.add(row.tableId);
      const foreignTableId = this.readForeignTableId(row);
      if (foreignTableId) involvedTableIds.add(foreignTableId);
    }
    const tables = await prisma.tableMeta.findMany({
      where: { id: { in: [...involvedTableIds] } },
      select: { id: true, baseId: true },
    });
    // moved tables already carry (or are about to carry) the target project
    const baseOf = new Map(
      tables.map((t) => [t.id, moved.has(t.id) ? plan.targetBaseId : t.baseId])
    );

    for (const row of candidates.values()) {
      const hostBaseId = baseOf.get(row.tableId);
      if (!hostBaseId) continue;
      // a previous pass may already have rewritten this row: diff against that
      const current = changes.get(row.id);
      const optionsRaw = current?.options?.after ?? row.options;
      const lookupRaw = current?.lookupOptions?.after ?? row.lookupOptions;
      const data: Pick<IFieldChange, 'options' | 'lookupOptions'> = {};

      const options = this.parseJson<Record<string, unknown>>(optionsRaw);
      if (options && typeof options.foreignTableId === 'string') {
        const foreignBaseId = baseOf.get(options.foreignTableId);
        if (foreignBaseId) {
          const next = this.withRebasedMarker(options, hostBaseId, foreignBaseId);
          if (next) data.options = { before: optionsRaw, after: JSON.stringify(next) };
        }
      }

      const lookupOptions = this.parseJson<Record<string, unknown>>(lookupRaw);
      if (lookupOptions && typeof lookupOptions.foreignTableId === 'string') {
        const foreignBaseId = baseOf.get(lookupOptions.foreignTableId);
        if (foreignBaseId) {
          const next = this.withRebasedMarker(lookupOptions, hostBaseId, foreignBaseId);
          if (next) data.lookupOptions = { before: lookupRaw, after: JSON.stringify(next) };
        }
      }

      if (data.options || data.lookupOptions) {
        await this.writeField(changes, row.id, row.tableId, data);
      }
    }
  }

  /** Returns the rewritten object, or undefined when nothing changes. */
  private withRebasedMarker(
    target: Record<string, unknown>,
    hostBaseId: string,
    foreignBaseId: string
  ): Record<string, unknown> | undefined {
    const current = typeof target.baseId === 'string' ? target.baseId : undefined;
    const expected = hostBaseId === foreignBaseId ? undefined : foreignBaseId;
    if (current === expected) return undefined;
    const { baseId: _baseId, ...rest } = target;
    return expected ? { ...rest, baseId: expected } : rest;
  }

  /** Fields whose `column` json carries `key = value`, trashed ones included. */
  private async findFieldsByOptionValue(
    column: 'options' | 'lookup_options',
    key: string,
    value: string
  ): Promise<IFieldRefRow[]> {
    return await this.prismaService.txClient().$queryRawUnsafe<IFieldRefRow[]>(
      this.knex('field')
        .select({
          id: 'id',
          tableId: 'table_id',
          options: 'options',
          lookupOptions: 'lookup_options',
        })
        .whereRaw(`${column}::json->>'${key}' = ?`, [value])
        .toQuery()
    );
  }

  /**
   * Fields on any table whose options or lookupOptions target one of
   * `tableIds`. The preview only wants what a user can see; the rewrite wants
   * every row that could ever come back from the trash.
   */
  private async findFieldsReferencingTables(
    tableIds: string[],
    { includeTrashed = false }: { includeTrashed?: boolean } = {}
  ): Promise<(IFieldRefRow & { name: string; type: string })[]> {
    if (tableIds.length === 0) return [];
    return await this.prismaService
      .txClient()
      .$queryRawUnsafe<(IFieldRefRow & { name: string; type: string })[]>(
        this.knex('field')
          .select({
            id: 'id',
            tableId: 'table_id',
            name: 'name',
            type: 'type',
            options: 'options',
            lookupOptions: 'lookup_options',
          })
          .modify((qb) => {
            if (!includeTrashed) qb.whereNull('deleted_time');
          })
          .where((qb) => {
            qb.whereRaw(`options::json->>'foreignTableId' = any(?::text[])`, [tableIds]).orWhereRaw(
              `lookup_options::json->>'foreignTableId' = any(?::text[])`,
              [tableIds]
            );
          })
          .toQuery()
      );
  }

  private readForeignTableId(row: {
    options: string | null;
    lookupOptions: string | null;
  }): string | undefined {
    const lookupOptions = this.parseJson<Record<string, unknown>>(row.lookupOptions);
    if (lookupOptions && typeof lookupOptions.foreignTableId === 'string') {
      return lookupOptions.foreignTableId;
    }
    const options = this.parseJson<Record<string, unknown>>(row.options);
    if (options && typeof options.foreignTableId === 'string') {
      return options.foreignTableId;
    }
    return undefined;
  }

  private parseJson<T>(value: string | null | undefined): T | undefined {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
}
