const PLAYGROUND_DB_URL_STORAGE_KEY = 'teable.playground.dbUrl';
const PLAYGROUND_DB_URL_HEADER = 'x-playground-db-url';
const PLAYGROUND_DB_URL_QUERY_PARAM = 'dbUrl';

const parseStoredValue = (raw: string): string | null => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed.trim() || null;
    if (parsed === null || parsed === undefined) return null;
  } catch {
    return raw.trim() || null;
  }
  return null;
};

export const readPlaygroundDbUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(PLAYGROUND_DB_URL_STORAGE_KEY);
  if (!raw) return null;
  return parseStoredValue(raw);
};

export const writePlaygroundDbUrl = (value: string | null): void => {
  if (typeof window === 'undefined') return;
  if (!value) {
    window.localStorage.removeItem(PLAYGROUND_DB_URL_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PLAYGROUND_DB_URL_STORAGE_KEY, JSON.stringify(value));
};

export const isValidPlaygroundDbUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
};

export const formatPlaygroundDbUrlLabel = (value: string): string => {
  try {
    const url = new URL(value);
    const host = url.hostname + (url.port ? `:${url.port}` : '');
    const dbName = url.pathname.replace(/^\//, '');
    if (!dbName) return host;
    return `${host}/${dbName}`;
  } catch {
    return 'Custom database';
  }
};

export { PLAYGROUND_DB_URL_HEADER, PLAYGROUND_DB_URL_QUERY_PARAM, PLAYGROUND_DB_URL_STORAGE_KEY };
