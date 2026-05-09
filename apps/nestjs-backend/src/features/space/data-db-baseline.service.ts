import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  IDataDbPreflightClientFactory,
  DATA_DB_PREFLIGHT_CLIENT_FACTORY,
  dataDbKnexClientFactory,
} from './data-db-preflight.service';

export const dataDbBaselineSqlToken = Symbol('DATA_DB_BASELINE_SQL');

const getBaselineSqlPath = () => {
  const candidates = [
    join(
      process.cwd(),
      'community/packages/db-data-prisma/prisma/migrations/20260421000000_init_data_db_baseline/migration.sql'
    ),
    join(
      process.cwd(),
      '../../community/packages/db-data-prisma/prisma/migrations/20260421000000_init_data_db_baseline/migration.sql'
    ),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error('Data DB baseline SQL migration not found');
  }
  return found;
};

const readBaselineSql = () => readFileSync(getBaselineSqlPath(), 'utf8');

@Injectable()
export class DataDbBaselineService {
  private readonly clientFactory: IDataDbPreflightClientFactory;

  constructor(
    @Optional()
    @Inject(dataDbBaselineSqlToken)
    private readonly baselineSql?: string,
    @Optional()
    @Inject(DATA_DB_PREFLIGHT_CLIENT_FACTORY)
    clientFactory?: IDataDbPreflightClientFactory
  ) {
    this.clientFactory = clientFactory ?? dataDbKnexClientFactory;
  }

  async initialize(url: string) {
    const sql = this.baselineSql ?? readBaselineSql();
    if (!sql.trim()) {
      return;
    }

    const client = this.clientFactory(url);
    try {
      await client.raw(sql);
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }
}
