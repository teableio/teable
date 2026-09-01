import { Injectable, Optional } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';
import {
  activeBaseDataDbMoveJobStates,
  baseDataDbMovingErrorCode,
} from '../base/base-data-db-move.constants';
import { DataDbHealthService } from './data-db-health.service';
import {
  activeSpaceDataDbMigrationStates,
  spaceDataDbMigratingErrorCode,
  spaceDataDbReadOnlyErrorCode,
} from './space-data-db-migration.constants';

const recordWriteBlockingStates = ['freezing_writes', 'switching'] as const;
const baseMoveRecordWriteBlockingStates = [
  'copying_base_schema',
  'copying_shared_rows',
  'validating',
  'switching',
] as const;

type IMigrationJobClient = {
  spaceDataDbMigrationJob: {
    findFirst(args: unknown): Promise<{ id: string; state: string } | null>;
    findMany(
      args: unknown
    ): Promise<{ id: string; state: string; spaceId: string; inventory: unknown }[]>;
  };
  baseDataDbMoveJob?: {
    findFirst(args: unknown): Promise<{ id: string; state: string } | null>;
  };
  base: PrismaService['base'];
  tableMeta: PrismaService['tableMeta'];
  txClient?: () => IMigrationJobClient;
};

type IMigrationJobReader = Pick<
  IMigrationJobClient,
  'spaceDataDbMigrationJob' | 'baseDataDbMoveJob'
>;

@Injectable()
export class SpaceDataDbMigrationGuardService {
  constructor(
    private readonly prismaService: PrismaService,
    @Optional() private readonly dataDbHealthService?: DataDbHealthService
  ) {}

  async assertSpaceSchemaWritable(spaceId: string): Promise<void> {
    await this.assertSpaceDataDbHealthy(spaceId);
    const activeJob = await this.findActiveMigrationForSpace(spaceId, [
      ...activeSpaceDataDbMigrationStates,
    ]);

    if (!activeJob) {
      return;
    }

    throw new CustomHttpException(
      'Space data database migration is in progress',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbMigratingErrorCode,
        migrationJobId: activeJob.id,
        migrationState: activeJob.state,
        spaceId,
      }
    );
  }

  async assertSpaceRecordWritable(spaceId: string): Promise<void> {
    await this.assertSpaceDataDbHealthy(spaceId);
    const activeJob = await this.findActiveMigrationForSpace(
      spaceId,
      [...recordWriteBlockingStates],
      {
        switchOnCompletionOnly: false,
      }
    );

    if (!activeJob) {
      return;
    }

    throw new CustomHttpException(
      'Space data database migration is switching data database',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbMigratingErrorCode,
        migrationJobId: activeJob.id,
        migrationState: activeJob.state,
        spaceId,
      }
    );
  }

  async assertSpaceWritable(spaceId: string): Promise<void> {
    await this.assertSpaceSchemaWritable(spaceId);
  }

  /**
   * Fail fast when the space's BYODB database is known read-only: without
   * this, every write travels to the customer database just to collect the
   * same rejection after a connect + queue delay. Only the deterministic
   * read_only state blocks — degraded/unreachable are fuzzy or transient, and
   * letting those writes flow keeps real errors and passive health signals
   * alive. The health lookup is 30s-cached and flushed on recovery, so
   * unblocking is prompt once the database accepts writes again.
   */
  private async assertSpaceDataDbHealthy(spaceId: string): Promise<void> {
    const health = await this.dataDbHealthService?.getHealthStateForSpace(spaceId);
    if (health !== 'read_only') {
      return;
    }
    throw new CustomHttpException(
      'Space data database is read-only; writes are paused until it accepts writes again',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbReadOnlyErrorCode,
        spaceId,
      }
    );
  }

  private async findActiveMigrationForSpace(
    spaceId: string,
    states: readonly string[],
    options: { switchOnCompletionOnly?: boolean } = { switchOnCompletionOnly: true }
  ) {
    const switchOnCompletionFilter =
      options.switchOnCompletionOnly === false
        ? {}
        : {
            switchOnCompletion: true,
          };
    try {
      const directJob = await this.migrationJobClient.spaceDataDbMigrationJob.findFirst({
        where: {
          spaceId,
          ...switchOnCompletionFilter,
          state: { in: [...states] },
        },
        select: { id: true, state: true },
      });
      if (directJob) {
        return directJob;
      }

      const activeJobs = await this.migrationJobClient.spaceDataDbMigrationJob.findMany({
        where: {
          ...switchOnCompletionFilter,
          state: { in: [...states] },
        },
        select: { id: true, state: true, spaceId: true, inventory: true },
      });
      return activeJobs.find((job) => this.inventoryContainsSpace(job.inventory, spaceId)) ?? null;
    } catch (error) {
      if (this.isMissingMigrationJobTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  private inventoryContainsSpace(inventory: unknown, spaceId: string) {
    if (!inventory || typeof inventory !== 'object') {
      return false;
    }
    const candidate = inventory as { spaceIds?: unknown; relatedSpaces?: { spaces?: unknown } };
    if (Array.isArray(candidate.spaceIds) && candidate.spaceIds.includes(spaceId)) {
      return true;
    }
    return (
      Array.isArray(candidate.relatedSpaces?.spaces) &&
      candidate.relatedSpaces.spaces.some(
        (space) =>
          space && typeof space === 'object' && (space as { spaceId?: unknown }).spaceId === spaceId
      )
    );
  }

  private isMissingMigrationJobTableError(error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('space_data_db_migration_job') &&
      (code === 'P2021' ||
        code === 'P2022' ||
        code === '42P01' ||
        message.includes('does not exist') ||
        message.includes('relation'))
    );
  }

  async assertBaseWritable(baseId: string): Promise<void> {
    await this.assertBaseSchemaWritable(baseId);
  }

  async assertBaseSchemaWritable(baseId: string): Promise<void> {
    const base = await this.prismaClient.base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new CustomHttpException(`Base ${baseId} not found`, HttpErrorCode.NOT_FOUND);
    }
    await this.assertActiveBaseMove(baseId);
    await this.assertSpaceSchemaWritable(base.spaceId);
  }

  async assertBaseRecordWritable(baseId: string): Promise<void> {
    const base = await this.prismaClient.base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new CustomHttpException(`Base ${baseId} not found`, HttpErrorCode.NOT_FOUND);
    }
    await this.assertActiveBaseMove(baseId, [...baseMoveRecordWriteBlockingStates]);
    await this.assertSpaceRecordWritable(base.spaceId);
  }

  private async assertActiveBaseMove(
    baseId: string,
    states: readonly string[] = activeBaseDataDbMoveJobStates
  ) {
    const activeJob = await this.findActiveBaseMove(baseId, states);
    if (!activeJob) {
      return;
    }
    throw new CustomHttpException(
      'Base data database move is in progress',
      HttpErrorCode.CONFLICT,
      {
        errorCode: baseDataDbMovingErrorCode,
        moveJobId: activeJob.id,
        moveState: activeJob.state,
        baseId,
      }
    );
  }

  private async findActiveBaseMove(baseId: string, states: readonly string[]) {
    try {
      const client = this.migrationJobClient.baseDataDbMoveJob;
      if (!client) {
        return null;
      }
      return await client.findFirst({
        where: {
          baseId,
          state: { in: [...states] },
        },
        select: { id: true, state: true },
      });
    } catch (error) {
      if (this.isMissingBaseMoveJobTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  private isMissingBaseMoveJobTableError(error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('base_data_db_move_job') &&
      (code === 'P2021' ||
        code === 'P2022' ||
        code === '42P01' ||
        message.includes('does not exist') ||
        message.includes('relation'))
    );
  }

  async assertTableWritable(tableId: string): Promise<void> {
    await this.assertTableSchemaWritable(tableId);
  }

  async assertTableSchemaWritable(tableId: string): Promise<void> {
    const table = await this.prismaClient.tableMeta.findUnique({
      where: { id: tableId },
      select: { baseId: true, base: { select: { spaceId: true } } },
    });
    if (!table) {
      throw new CustomHttpException(`Table ${tableId} not found`, HttpErrorCode.NOT_FOUND);
    }
    await this.assertActiveBaseMove(table.baseId);
    await this.assertSpaceSchemaWritable(table.base.spaceId);
  }

  async assertTableRecordWritable(tableId: string): Promise<void> {
    const table = await this.prismaClient.tableMeta.findUnique({
      where: { id: tableId },
      select: { baseId: true, base: { select: { spaceId: true } } },
    });
    if (!table) {
      throw new CustomHttpException(`Table ${tableId} not found`, HttpErrorCode.NOT_FOUND);
    }
    await this.assertActiveBaseMove(table.baseId, [...baseMoveRecordWriteBlockingStates]);
    await this.assertSpaceRecordWritable(table.base.spaceId);
  }

  async assertTableRecordSearchReadable(
    tableId: string,
    query?: { search?: unknown }
  ): Promise<void> {
    if (!query?.search) {
      return;
    }
    const table = await this.prismaClient.tableMeta.findUnique({
      where: { id: tableId },
      select: { baseId: true, base: { select: { spaceId: true } } },
    });
    if (!table) {
      return;
    }
    const activeJob = await this.findActiveMigrationForSpace(
      table.base.spaceId,
      [...activeSpaceDataDbMigrationStates],
      { switchOnCompletionOnly: false }
    );
    if (!activeJob) {
      return;
    }

    throw new CustomHttpException(
      'Search is temporarily degraded during data database migration',
      HttpErrorCode.TOO_MANY_REQUESTS,
      {
        errorCode: spaceDataDbMigratingErrorCode,
        migrationJobId: activeJob.id,
        migrationState: activeJob.state,
        spaceId: table.base.spaceId,
      }
    );
  }

  private get prismaClient(): IMigrationJobClient {
    const client = this.prismaService as unknown as IMigrationJobClient;
    return client.txClient?.() ?? client;
  }

  private get migrationJobClient(): IMigrationJobReader {
    return this.prismaService as unknown as IMigrationJobReader;
  }
}
