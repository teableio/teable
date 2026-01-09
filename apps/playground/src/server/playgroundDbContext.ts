import { AsyncLocalStorage } from 'node:async_hooks';

type PlaygroundDbContext = {
  connectionString?: string;
};

const storage = new AsyncLocalStorage<PlaygroundDbContext>();

export const withPlaygroundDbContext = async <T>(
  connectionString: string | undefined,
  callback: () => Promise<T>
): Promise<T> => {
  if (!connectionString) {
    return callback();
  }
  return storage.run({ connectionString }, callback);
};

export const getPlaygroundDbConnectionString = (): string | undefined => {
  return storage.getStore()?.connectionString;
};
