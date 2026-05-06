import { Injectable } from '@nestjs/common';
import { getDatabaseUrl, MetaPrismaService } from '@teable/db-main-prisma';
import { DataPrismaService } from '@teable/db-data-prisma';
import type { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { DATA_KNEX, META_KNEX } from './knex';

@Injectable()
export class DatabaseRouter {
  constructor(
    private readonly metaPrismaService: MetaPrismaService,
    private readonly dataPrismaService: DataPrismaService,
    @InjectModel(META_KNEX) private readonly metaKnexClient: Knex,
    @InjectModel(DATA_KNEX) private readonly dataKnexClient: Knex
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
}
