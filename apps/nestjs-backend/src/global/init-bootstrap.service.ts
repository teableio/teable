import { Injectable, Logger } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { getDriverName } from '../utils/db-helpers';

@Injectable()
export class InitBootstrapService {
  private readonly logger = new Logger(InitBootstrapService.name);
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async init() {
    const driverName = getDriverName(this.knex);

    if (driverName === DriverClient.Sqlite) {
      await this.prismaService
        .$queryRaw`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`.catch((error) => {
        this.logger.error('Prisma Set `PRAGMA` Failed due to:', error.stack);
        process.exit(1);
      });
    }
  }
}
