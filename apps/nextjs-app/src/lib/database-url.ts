const APP_DATABASE_ENV_KEYS = [
  'PRISMA_META_DATABASE_URL',
  'PRISMA_DATABASE_URL',
  'DATABASE_URL',
  'PRISMA_DATA_DATABASE_URL',
] as const;

export const getAppDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  for (const key of APP_DATABASE_ENV_KEYS) {
    const value = env[key];
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing database url (${APP_DATABASE_ENV_KEYS.join(', ')})`);
};
