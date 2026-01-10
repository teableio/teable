export const DEFAULT_CONNECTION_STRING =
  'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public';

export const getConnectionString = (connectionOption?: string): string => {
  return (
    connectionOption ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_CONNECTION_STRING
  );
};
