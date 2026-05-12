import { Injectable } from '@nestjs/common';
import { DataPrismaService } from '@teable/db-data-prisma';
import { getDatabaseUrl, MetaPrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { DataDbClientManager } from './data-db-client-manager.service';
import { DATA_KNEX, META_KNEX } from './knex';

@Injectable()
export class DatabaseRouter {
  constructor(
    private readonly metaPrismaService: MetaPrismaService,
    private readonly dataPrismaService: DataPrismaService,
    @InjectModel(META_KNEX) private readonly metaKnexClient: Knex,
    @InjectModel(DATA_KNEX) private readonly dataKnexClient: Knex,
    private readonly dataDbClientManager: DataDbClientManager
  ) {}

  metaPrisma() {
    return this.metaPrismaService;
  }

  dataPrisma() {
    return this.dataPrismaService;
  }

  metaKnex() {
    return this.metaKnexClient;
  }

  dataKnex() {
    return this.dataKnexClient;
  }

  getDatabaseUrl(target: 'meta' | 'data') {
    return getDatabaseUrl(target);
  }

  async getDataDatabaseUrlForSpace(spaceId: string) {
    return await this.dataDbClientManager.getDataDatabaseUrlForSpace(spaceId);
  }

  async dataKnexForSpace(spaceId: string) {
    return await this.dataDbClientManager.dataKnexForSpace(spaceId);
  }

  async dataPrismaForSpace(spaceId: string) {
    return await this.dataDbClientManager.dataPrismaForSpace(spaceId);
  }

  async dataKnexForBase(baseId: string) {
    return await this.dataDbClientManager.dataKnexForBase(baseId);
  }

  async dataPrismaForBase(baseId: string) {
    return await this.dataDbClientManager.dataPrismaForBase(baseId);
  }
}
