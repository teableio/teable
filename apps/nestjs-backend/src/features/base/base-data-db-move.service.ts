import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IBaseDataDbMoveJobStatusVo,
  IMoveBaseDataDbCheck,
  IMoveBaseDataDbEndpoint,
  IMoveBaseVo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { Client as PgClient } from 'pg';
import { CustomHttpException } from '../../custom.exception';
import {
  DataDbClientManager,
  type IResolvedDataDatabase,
} from '../../global/data-db-client-manager.service';
import type { IClsStore } from '../../types/cls';
import { SpaceDataDbCopyService } from '../space/space-data-db-copy.service';
import { buildMigrationSharedTablePsqlCopyPlans } from '../space/space-data-db-copy-plan';
import { activeSpaceDataDbMigrationStates } from '../space/space-data-db-migration.constants';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';
import {
  activeBaseDataDbMoveJobStates,
  baseDataDbMoveProgressWeights,
  baseDataDbMovingErrorCode,
  cancelableBaseDataDbMoveJobStates,
  type IBaseDataDbMovePhase,
} from './base-data-db-move.constants';
import { BASE_META_MOVE_SERVICE, type IBaseMetaMoveService } from './base-meta-move.service';

type IBaseMoveInventory = {
  baseId: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  tableIds: string[];
  dbTableNames: string[];
  sourceInternalSchema: string;
  targetInternalSchema: string;
  sourceCacheKey: string;
  targetCacheKey: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const stripUrlSearchParamsForDump = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('schema');
    parsed.searchParams.delete('options');
    return parsed.toString();
  } catch {
    return url;
  }
};

@Injectable()
export class BaseDataDbMoveService {
  private readonly logger = new Logger(BaseDataDbMoveService.name);
  private readonly runningJobs = new Set<string>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly copyService: SpaceDataDbCopyService,
    private readonly cls: ClsService<IClsStore>,
    @Inject(BASE_META_MOVE_SERVICE)
    private readonly baseService: IBaseMetaMoveService,
    @Optional()
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService
  ) {}

  async resolveDataDbCheck(baseId: string, targetSpaceId: string): Promise<IMoveBaseDataDbCheck> {
    const base = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
      select: { id: true, spaceId: true },
    });
    const [source, target] = await Promise.all([
      this.dataDbClientManager.getDataDatabaseForSpace(base.spaceId),
      this.dataDbClientManager.getDataDatabaseForSpace(targetSpaceId),
    ]);
    const sameDataDb = source.cacheKey === target.cacheKey;
    return {
      sameDataDb,
      requiresPhysicalMove: !sameDataDb,
      source: await this.toEndpointSummary(source, base.spaceId),
      target: await this.toEndpointSummary(target, targetSpaceId),
    };
  }

  async startPhysicalMove(baseId: string, targetSpaceId: string): Promise<IMoveBaseVo> {
    const userId = this.cls.get('user.id');
    const base = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId, deletedTime: null },
      select: { id: true, spaceId: true },
    });

    if (base.spaceId === targetSpaceId) {
      throw new CustomHttpException(
        'Base is already in the target space',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);
    await this.spaceDataDbMigrationGuard?.assertSpaceWritable(targetSpaceId);
    await this.assertNoActiveSpaceMigration(base.spaceId);
    await this.assertNoActiveSpaceMigration(targetSpaceId);
    await this.assertNoActiveBaseMove(baseId);

    const [source, target] = await Promise.all([
      this.dataDbClientManager.getDataDatabaseForSpace(base.spaceId),
      this.dataDbClientManager.getDataDatabaseForSpace(targetSpaceId),
    ]);
    if (source.cacheKey === target.cacheKey) {
      throw new CustomHttpException(
        'Physical base move is only required across different data databases',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const inventory = await this.buildInventory(
      baseId,
      base.spaceId,
      targetSpaceId,
      source,
      target
    );
    const job = await this.prismaService.baseDataDbMoveJob.create({
      data: {
        baseId,
        sourceSpaceId: base.spaceId,
        targetSpaceId,
        sourceConnectionId: source.connectionId ?? null,
        targetConnectionId: target.connectionId ?? null,
        state: 'waiting_worker',
        inventory,
        copyStats: {
          phase: 'preparing',
          progress: { percent: 0, phase: 'preparing' },
        },
        createdBy: userId,
        startedAt: new Date(),
      },
    });

    void this.runMoveJob(job.id).catch((error) => {
      this.logger.error(
        `Base data DB move job ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    });

    return { jobId: job.id, async: true };
  }

  async getJobStatus(baseId: string, jobId: string): Promise<IBaseDataDbMoveJobStatusVo> {
    const job = await this.prismaService.baseDataDbMoveJob.findFirst({
      where: { id: jobId, baseId },
    });
    if (!job) {
      throw new CustomHttpException(`Move job ${jobId} not found`, HttpErrorCode.NOT_FOUND);
    }
    return this.toStatusVo(job);
  }

  async cancelJob(baseId: string, jobId: string): Promise<IBaseDataDbMoveJobStatusVo> {
    const job = await this.prismaService.baseDataDbMoveJob.findFirst({
      where: { id: jobId, baseId },
    });
    if (!job) {
      throw new CustomHttpException(`Move job ${jobId} not found`, HttpErrorCode.NOT_FOUND);
    }
    if (!(cancelableBaseDataDbMoveJobStates as readonly string[]).includes(job.state)) {
      throw new CustomHttpException(
        `Move job ${jobId} cannot be cancelled in state ${job.state}`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const updated = await this.prismaService.baseDataDbMoveJob.update({
      where: { id: jobId },
      data: {
        state: 'cancelled',
        completedAt: new Date(),
        lastError: 'Cancelled by user',
        copyStats: {
          ...(asRecord(job.copyStats) ?? {}),
          phase: 'cancelled',
          progress: { percent: this.readProgressPercent(job.copyStats), phase: 'cancelled' },
        },
      },
    });
    return this.toStatusVo(updated);
  }

  async retryJob(baseId: string, jobId: string): Promise<IBaseDataDbMoveJobStatusVo> {
    const job = await this.prismaService.baseDataDbMoveJob.findFirst({
      where: { id: jobId, baseId },
    });
    if (!job) {
      throw new CustomHttpException(`Move job ${jobId} not found`, HttpErrorCode.NOT_FOUND);
    }
    if (job.state !== 'failed') {
      throw new CustomHttpException(
        `Only failed move jobs can be retried (current: ${job.state})`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const inventory = this.readInventory(job.inventory);
    await this.cleanupTargetArtifacts(inventory).catch((error) => {
      this.logger.warn(
        `Retry cleanup for job ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    const updated = await this.prismaService.baseDataDbMoveJob.update({
      where: { id: jobId },
      data: {
        state: 'waiting_worker',
        lastError: null,
        completedAt: null,
        startedAt: new Date(),
        copyStats: {
          phase: 'preparing',
          progress: { percent: 0, phase: 'preparing' },
          retryOf: jobId,
        },
        validationStats: undefined,
      },
    });

    void this.runMoveJob(jobId).catch((error) => {
      this.logger.error(
        `Retried base data DB move job ${jobId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });

    return this.toStatusVo(updated);
  }

  async hasActiveMoveForBase(baseId: string): Promise<{ id: string; state: string } | null> {
    try {
      return await this.prismaService.baseDataDbMoveJob.findFirst({
        where: {
          baseId,
          state: { in: [...activeBaseDataDbMoveJobStates] },
        },
        select: { id: true, state: true },
      });
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async runMoveJob(jobId: string): Promise<void> {
    if (this.runningJobs.has(jobId)) {
      return;
    }
    this.runningJobs.add(jobId);
    const workDir = path.join(tmpdir(), `teable-base-data-db-move-${jobId}`);
    try {
      const job = await this.prismaService.baseDataDbMoveJob.findUnique({ where: { id: jobId } });
      if (!job) {
        return;
      }
      if (job.state === 'cancelled' || job.state === 'succeeded') {
        return;
      }

      const inventory = this.readInventory(job.inventory);
      const [source, target] = await Promise.all([
        this.dataDbClientManager.getDataDatabaseForSpace(inventory.sourceSpaceId),
        this.dataDbClientManager.getDataDatabaseForSpace(inventory.targetSpaceId),
      ]);
      const sourceUrl = stripUrlSearchParamsForDump(source.url);
      const targetUrl = stripUrlSearchParamsForDump(target.url);

      await this.assertNotCancelled(jobId);
      await this.updateJob(jobId, {
        state: 'copying_base_schema',
        copyStats: this.buildCopyStats('copying_base_schema', 0.05),
        lastError: null,
      });

      await this.copyService.assertPostgresToolsAvailable('pg_dump_stream_restore');
      await mkdir(workDir, { recursive: true });

      await this.assertTargetSchemaAbsent(targetUrl, inventory.baseId);

      await this.assertNotCancelled(jobId);
      await this.copyService.copyBaseSchemas({
        sourceUrl,
        targetUrl,
        schemaNames: [inventory.baseId],
        workDir,
        strategy: 'pg_dump_stream_restore',
      });

      await this.assertNotCancelled(jobId);
      await this.updateJob(jobId, {
        state: 'copying_shared_rows',
        copyStats: this.buildCopyStats('copying_shared_rows', 0.65),
      });

      const sharedPlans = buildMigrationSharedTablePsqlCopyPlans({
        sourceUrl,
        targetUrl,
        sourceSchema: inventory.sourceInternalSchema,
        targetSchema: inventory.targetInternalSchema,
        spaceId: inventory.sourceSpaceId,
        spaceIds: [],
        baseIds: [inventory.baseId],
        tableIds: inventory.tableIds,
        includeSpacePauseScopes: false,
      });
      const sharedResults = await this.copyService.copySharedTables(sharedPlans);

      await this.assertNotCancelled(jobId);
      await this.updateJob(jobId, {
        state: 'validating',
        copyStats: this.buildCopyStats('validating', 0.85, {
          sharedTables: sharedResults.map((r) => ({
            table: r.table,
            copiedRows: r.copiedRows,
          })),
        }),
      });

      await this.validateTargetSchema(targetUrl, inventory.baseId);
      const validationStats = {
        baseSchemaPresent: true,
        sharedTablesCopied: sharedResults.length,
        sharedRows: sharedResults.reduce((sum, r) => sum + (r.copiedRows ?? 0), 0),
      };

      await this.assertNotCancelled(jobId);
      await this.updateJob(jobId, {
        state: 'switching',
        copyStats: this.buildCopyStats('switching', 0.92),
        validationStats,
      });

      // Meta switch while base still routes to source until spaceId updates.
      await this.cls.run(async () => {
        this.cls.set('user.id', job.createdBy);
        await this.baseService.applyMetaMoveBase(inventory.baseId, inventory.targetSpaceId);
      });

      await this.cleanupSourceArtifacts(sourceUrl, inventory).catch((error) => {
        this.logger.warn(
          `Source cleanup after base move ${jobId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });

      await this.updateJob(jobId, {
        state: 'succeeded',
        completedAt: new Date(),
        copyStats: this.buildCopyStats('switching', 1, {
          completed: true,
        }),
        validationStats,
        lastError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = await this.prismaService.baseDataDbMoveJob.findUnique({
        where: { id: jobId },
        select: { state: true, inventory: true, copyStats: true },
      });
      if (current?.state === 'cancelled') {
        return;
      }
      if (current?.inventory) {
        await this.cleanupTargetArtifacts(this.readInventory(current.inventory)).catch(() => {
          // best-effort
        });
      }
      await this.updateJob(jobId, {
        state: 'failed',
        completedAt: new Date(),
        lastError: message,
        copyStats: {
          ...(asRecord(current?.copyStats) ?? {}),
          phase: current?.state ?? 'failed',
          progress: {
            percent: this.readProgressPercent(current?.copyStats),
            phase: current?.state ?? 'failed',
          },
          failedAt: new Date().toISOString(),
        },
      });
      throw error;
    } finally {
      this.runningJobs.delete(jobId);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async toEndpointSummary(
    dataDb: IResolvedDataDatabase,
    spaceId: string
  ): Promise<IMoveBaseDataDbEndpoint> {
    if (dataDb.isMetaFallback) {
      return {
        mode: 'default',
        cacheKey: dataDb.cacheKey,
        internalSchema: 'public',
      };
    }
    const binding = await this.prismaService.spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });
    return {
      mode: 'byodb',
      cacheKey: dataDb.cacheKey,
      connectionId: dataDb.connectionId,
      displayHost: binding?.dataDbConnection?.displayHost ?? null,
      displayDatabase: binding?.dataDbConnection?.displayDatabase ?? null,
      internalSchema: dataDb.internalSchema,
    };
  }

  private async buildInventory(
    baseId: string,
    sourceSpaceId: string,
    targetSpaceId: string,
    source: IResolvedDataDatabase,
    target: IResolvedDataDatabase
  ): Promise<IBaseMoveInventory> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId },
      select: { id: true, dbTableName: true },
    });
    return {
      baseId,
      sourceSpaceId,
      targetSpaceId,
      tableIds: tables.map((t) => t.id),
      dbTableNames: tables.map((t) => t.dbTableName),
      sourceInternalSchema: source.internalSchema ?? 'public',
      targetInternalSchema: target.internalSchema ?? 'public',
      sourceCacheKey: source.cacheKey,
      targetCacheKey: target.cacheKey,
    };
  }

  private readInventory(raw: unknown): IBaseMoveInventory {
    const inv = asRecord(raw);
    if (!inv || typeof inv.baseId !== 'string') {
      throw new CustomHttpException('Invalid base move inventory', HttpErrorCode.VALIDATION_ERROR);
    }
    return {
      baseId: inv.baseId as string,
      sourceSpaceId: inv.sourceSpaceId as string,
      targetSpaceId: inv.targetSpaceId as string,
      tableIds: Array.isArray(inv.tableIds) ? (inv.tableIds as string[]) : [],
      dbTableNames: Array.isArray(inv.dbTableNames) ? (inv.dbTableNames as string[]) : [],
      sourceInternalSchema: (inv.sourceInternalSchema as string) || 'public',
      targetInternalSchema: (inv.targetInternalSchema as string) || 'public',
      sourceCacheKey: (inv.sourceCacheKey as string) || '',
      targetCacheKey: (inv.targetCacheKey as string) || '',
    };
  }

  private buildCopyStats(
    phase: IBaseDataDbMovePhase | string,
    stageFraction: number,
    extra: Record<string, unknown> = {}
  ) {
    const percent = Math.min(
      100,
      Math.round(this.phaseBasePercent(phase) + stageFraction * this.phaseWeight(phase))
    );
    return {
      phase,
      progress: { percent, phase },
      ...extra,
      updatedAt: new Date().toISOString(),
    };
  }

  private phaseWeight(phase: string) {
    return baseDataDbMoveProgressWeights[phase as IBaseDataDbMovePhase] ?? 10;
  }

  private phaseBasePercent(phase: string) {
    let total = 0;
    for (const [key, weight] of Object.entries(baseDataDbMoveProgressWeights)) {
      if (key === phase) break;
      total += weight;
    }
    return total;
  }

  private readProgressPercent(copyStats: unknown) {
    const stats = asRecord(copyStats);
    const progress = asRecord(stats?.progress);
    return typeof progress?.percent === 'number' ? progress.percent : 0;
  }

  private async updateJob(
    jobId: string,
    data: {
      state?: string;
      copyStats?: unknown;
      validationStats?: unknown;
      lastError?: string | null;
      completedAt?: Date | null;
      startedAt?: Date | null;
    }
  ) {
    await this.prismaService.baseDataDbMoveJob.update({
      where: { id: jobId },
      data: data as never,
    });
  }

  private toStatusVo(job: {
    id: string;
    baseId: string;
    sourceSpaceId: string;
    targetSpaceId: string;
    state: string;
    copyStats: unknown;
    validationStats: unknown;
    lastError: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdTime: Date;
  }): IBaseDataDbMoveJobStatusVo {
    const stats = asRecord(job.copyStats);
    const progress = asRecord(stats?.progress);
    return {
      id: job.id,
      baseId: job.baseId,
      sourceSpaceId: job.sourceSpaceId,
      targetSpaceId: job.targetSpaceId,
      state: job.state as IBaseDataDbMoveJobStatusVo['state'],
      phase: typeof stats?.phase === 'string' ? stats.phase : job.state,
      progressPercent: typeof progress?.percent === 'number' ? progress.percent : undefined,
      copyStats: job.copyStats ?? undefined,
      validationStats: job.validationStats ?? undefined,
      lastError: job.lastError,
      cancelable: (cancelableBaseDataDbMoveJobStates as readonly string[]).includes(job.state),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdTime: job.createdTime.toISOString(),
    };
  }

  private async assertNoActiveBaseMove(baseId: string) {
    const active = await this.hasActiveMoveForBase(baseId);
    if (active) {
      throw new CustomHttpException(
        'A base data database move is already in progress',
        HttpErrorCode.CONFLICT,
        {
          errorCode: baseDataDbMovingErrorCode,
          moveJobId: active.id,
          moveState: active.state,
          baseId,
        }
      );
    }
  }

  private async assertNoActiveSpaceMigration(spaceId: string) {
    try {
      const active = await this.prismaService.spaceDataDbMigrationJob.findFirst({
        where: {
          spaceId,
          state: { in: [...activeSpaceDataDbMigrationStates] },
        },
        select: { id: true, state: true },
      });
      if (active) {
        throw new CustomHttpException(
          'Space data database migration is in progress',
          HttpErrorCode.CONFLICT,
          {
            errorCode: 'SPACE_DATA_DB_MIGRATING',
            migrationJobId: active.id,
            migrationState: active.state,
            spaceId,
          }
        );
      }
    } catch (error) {
      if (error instanceof CustomHttpException) throw error;
      if (this.isMissingTableError(error)) return;
      throw error;
    }
  }

  private async assertNotCancelled(jobId: string) {
    const job = await this.prismaService.baseDataDbMoveJob.findUnique({
      where: { id: jobId },
      select: { state: true },
    });
    if (!job || job.state === 'cancelled') {
      throw new CustomHttpException('Move job was cancelled', HttpErrorCode.CONFLICT);
    }
  }

  private async withPgClient<T>(url: string, fn: (client: PgClient) => Promise<T>): Promise<T> {
    const client = new PgClient({ connectionString: url });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async assertTargetSchemaAbsent(targetUrl: string, schemaName: string) {
    await this.withPgClient(targetUrl, async (client) => {
      const result = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM pg_namespace WHERE nspname = $1
        ) AS exists`,
        [schemaName]
      );
      if (result.rows[0]?.exists) {
        throw new CustomHttpException(
          `Target data database already has schema ${schemaName}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
    });
  }

  private async validateTargetSchema(targetUrl: string, schemaName: string) {
    await this.withPgClient(targetUrl, async (client) => {
      const result = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM pg_namespace WHERE nspname = $1
        ) AS exists`,
        [schemaName]
      );
      if (!result.rows[0]?.exists) {
        throw new CustomHttpException(
          `Target schema ${schemaName} missing after copy`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
    });
  }

  private async cleanupTargetArtifacts(inventory: IBaseMoveInventory) {
    const target = await this.dataDbClientManager.getDataDatabaseForSpace(inventory.targetSpaceId);
    const targetUrl = stripUrlSearchParamsForDump(target.url);
    await this.withPgClient(targetUrl, async (client) => {
      await client.query(`DROP SCHEMA IF EXISTS ${this.quoteIdent(inventory.baseId)} CASCADE`);
      await this.deleteSharedRows(client, inventory.targetInternalSchema, inventory);
    });
  }

  private async cleanupSourceArtifacts(sourceUrl: string, inventory: IBaseMoveInventory) {
    await this.withPgClient(sourceUrl, async (client) => {
      await client.query(`DROP SCHEMA IF EXISTS ${this.quoteIdent(inventory.baseId)} CASCADE`);
      await this.deleteSharedRows(client, inventory.sourceInternalSchema, inventory);
    });
  }

  private async deleteSharedRows(client: PgClient, schema: string, inventory: IBaseMoveInventory) {
    const schemaIdent = this.quoteIdent(schema);
    const tableIds = inventory.tableIds;
    const baseId = inventory.baseId;
    if (tableIds.length) {
      await client.query(
        `DELETE FROM ${schemaIdent}."record_history" WHERE table_id = ANY($1::text[])`,
        [tableIds]
      );
      await client.query(
        `DELETE FROM ${schemaIdent}."table_trash" WHERE table_id = ANY($1::text[])`,
        [tableIds]
      );
      await client.query(
        `DELETE FROM ${schemaIdent}."record_trash" WHERE table_id = ANY($1::text[])`,
        [tableIds]
      );
    }
    await client.query(`DELETE FROM ${schemaIdent}."computed_update_outbox" WHERE base_id = $1`, [
      baseId,
    ]);
    await client.query(
      `DELETE FROM ${schemaIdent}."computed_update_dead_letter" WHERE base_id = $1`,
      [baseId]
    );
    await client.query(
      `DELETE FROM ${schemaIdent}."computed_update_pause_scope"
       WHERE (scope_type = 'base' AND scope_id = $1)
          OR (scope_type = 'table' AND scope_id = ANY($2::text[]))`,
      [baseId, tableIds]
    );
    await client.query(
      `DELETE FROM ${schemaIdent}."__undo_log"
       WHERE split_part(table_name, '.', 1) = $1`,
      [baseId]
    );
  }

  private quoteIdent(identifier: string) {
    return `"${identifier.replaceAll('"', '""')}"`;
  }

  private isMissingTableError(error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return (
      (message.includes('base_data_db_move_job') ||
        message.includes('space_data_db_migration_job')) &&
      (code === 'P2021' ||
        code === 'P2022' ||
        code === '42P01' ||
        message.includes('does not exist') ||
        message.includes('relation'))
    );
  }
}
