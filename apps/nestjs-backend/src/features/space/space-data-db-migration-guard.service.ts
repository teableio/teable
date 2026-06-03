import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';
import {
  activeSpaceDataDbMigrationStates,
  spaceDataDbMigratingErrorCode,
} from './space-data-db-migration.constants';

type IMigrationJobClient = {
  spaceDataDbMigrationJob: {
    findFirst(args: unknown): Promise<{ id: string; state: string } | null>;
    findMany(
      args: unknown
    ): Promise<{ id: string; state: string; spaceId: string; inventory: unknown }[]>;
  };
  base: PrismaService['base'];
  tableMeta: PrismaService['tableMeta'];
  txClient?: () => IMigrationJobClient;
};

@Injectable()
export class SpaceDataDbMigrationGuardService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertSpaceWritable(spaceId: string): Promise<void> {
    const activeJob = await this.findActiveMigrationForSpace(spaceId);

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

  private async findActiveMigrationForSpace(spaceId: string) {
    const directJob = await this.prismaClient.spaceDataDbMigrationJob.findFirst({
      where: {
        spaceId,
        state: { in: [...activeSpaceDataDbMigrationStates] },
      },
      select: { id: true, state: true },
    });
    if (directJob) {
      return directJob;
    }

    const activeJobs = await this.prismaClient.spaceDataDbMigrationJob.findMany({
      where: {
        state: { in: [...activeSpaceDataDbMigrationStates] },
      },
      select: { id: true, state: true, spaceId: true, inventory: true },
    });
    return activeJobs.find((job) => this.inventoryContainsSpace(job.inventory, spaceId)) ?? null;
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
          space &&
          typeof space === 'object' &&
          (space as { spaceId?: unknown }).spaceId === spaceId
      )
    );
  }

  async assertBaseWritable(baseId: string): Promise<void> {
    const base = await this.prismaClient.base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new CustomHttpException(`Base ${baseId} not found`, HttpErrorCode.NOT_FOUND);
    }
    await this.assertSpaceWritable(base.spaceId);
  }

  async assertTableWritable(tableId: string): Promise<void> {
    const table = await this.prismaClient.tableMeta.findUnique({
      where: { id: tableId },
      select: { base: { select: { spaceId: true } } },
    });
    if (!table) {
      throw new CustomHttpException(`Table ${tableId} not found`, HttpErrorCode.NOT_FOUND);
    }
    await this.assertSpaceWritable(table.base.spaceId);
  }

  private get prismaClient(): IMigrationJobClient {
    const client = this.prismaService as unknown as IMigrationJobClient;
    return client.txClient?.() ?? client;
  }
}
