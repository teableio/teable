import {
  v2DataDbTokens,
  v2MetaDbTokens,
  type IV2PostgresDbConfig,
} from '@teable/v2-adapter-db-postgres-shared';
import { v2CoreTokens, type IUnitOfWork } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { v2VcsServerTokens } from '@teable/v2-vcs/server';
import type { Kysely } from 'kysely';

import {
  PostgresBaseVcsLogRepository,
  type IBaseVcsDatabase,
} from './PostgresBaseVcsLogRepository';
import { v2VcsPostgresTokens, type IV2VcsPostgresAdapterConfig } from './tokens';

export const registerV2VcsPostgresAdapter = (
  c: DependencyContainer,
  config: IV2VcsPostgresAdapterConfig = {}
): DependencyContainer => {
  c.registerInstance(v2VcsPostgresTokens.config, config);
  let instance: PostgresBaseVcsLogRepository | undefined;
  c.register(v2VcsServerTokens.logRepository, {
    useFactory: (dep) => {
      if (!instance) {
        instance = new PostgresBaseVcsLogRepository(
          dep.resolve<Kysely<IBaseVcsDatabase>>(v2DataDbTokens.db),
          dep.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork),
          dep.isRegistered(v2MetaDbTokens.db)
            ? dep.resolve<Kysely<unknown>>(v2MetaDbTokens.db)
            : undefined,
          dep.isRegistered(v2MetaDbTokens.config)
            ? dep.resolve<IV2PostgresDbConfig>(v2MetaDbTokens.config)
            : undefined,
          dep.isRegistered(v2DataDbTokens.config)
            ? dep.resolve<IV2PostgresDbConfig>(v2DataDbTokens.config)
            : undefined,
          dep.isRegistered(v2VcsPostgresTokens.config)
            ? dep.resolve<IV2VcsPostgresAdapterConfig>(v2VcsPostgresTokens.config)
            : config
        );
      }
      return instance;
    },
  });
  return c;
};
