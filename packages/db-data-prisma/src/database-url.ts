const META_DATABASE_ENV_KEYS = ['PRISMA_META_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL'];

export const getMetaDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  for (const key of META_DATABASE_ENV_KEYS) {
    const value = env[key];
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing meta database url (${META_DATABASE_ENV_KEYS.join(', ')})`);
};

export const getDataDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  getMetaDatabaseUrl(env);

export const isSharedMetaDataDatabase = (env: NodeJS.ProcessEnv = process.env): boolean =>
  getMetaDatabaseUrl(env) === getDataDatabaseUrl(env);
