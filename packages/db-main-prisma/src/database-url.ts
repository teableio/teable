export type IDatabaseTarget = 'meta' | 'data';

const metaDatabaseEnvKeys = ['PRISMA_META_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL'];
const dataDatabaseEnvKeys = [
  'PRISMA_DATA_DATABASE_URL',
  'PRISMA_META_DATABASE_URL',
  'PRISMA_DATABASE_URL',
  'DATABASE_URL',
];

export const getDatabaseUrl = (
  target: IDatabaseTarget,
  env: NodeJS.ProcessEnv = process.env
): string => {
  const keys = target === 'data' ? dataDatabaseEnvKeys : metaDatabaseEnvKeys;
  for (const key of keys) {
    const value = env[key];
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing ${target} database url (${keys.join(', ')})`);
};
