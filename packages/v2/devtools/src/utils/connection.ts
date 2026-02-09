import * as path from 'node:path';

export const DEFAULT_CONNECTION_STRING =
  'postgresql://teable:teable@127.0.0.1:5432/teable?schema=public';

/** PGlite connection string prefix */
export const PGLITE_PROTOCOL = 'pglite://';

/** Default pglite data directory (relative to devtools package) */
export const DEFAULT_PGLITE_DATA_DIR = '.pglite-data';

export const getConnectionString = (connectionOption?: string): string => {
  return (
    connectionOption ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_CONNECTION_STRING
  );
};

/**
 * Check if a connection string uses the pglite:// protocol.
 * @example
 * isPgliteConnection('pglite://.pglite-data/session-001') // true
 * isPgliteConnection('postgresql://...') // false
 */
export const isPgliteConnection = (connStr: string): boolean => {
  return connStr.startsWith(PGLITE_PROTOCOL);
};

/**
 * Parse the data directory path from a pglite:// connection string.
 * @example
 * parsePgliteDataDir('pglite://.pglite-data/session-001') // '.pglite-data/session-001'
 * parsePgliteDataDir('pglite:///absolute/path') // '/absolute/path'
 */
export const parsePgliteDataDir = (connStr: string): string => {
  if (!isPgliteConnection(connStr)) {
    throw new Error(`Not a pglite connection string: ${connStr}`);
  }
  return connStr.slice(PGLITE_PROTOCOL.length);
};

/**
 * Generate a new pglite connection string with a unique session identifier.
 * Uses timestamp + random suffix to ensure uniqueness.
 * @param baseDir - Base directory for pglite data (default: .pglite-data)
 * @returns A pglite:// connection string
 */
export const generatePgliteConnectionString = (baseDir = DEFAULT_PGLITE_DATA_DIR): string => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const sessionDir = `session-${timestamp}-${randomSuffix}`;
  return `${PGLITE_PROTOCOL}${path.join(baseDir, sessionDir)}`;
};

/**
 * Get the absolute path for a pglite data directory.
 * Resolves relative paths against the current working directory.
 */
export const getAbsolutePgliteDataDir = (connStr: string): string => {
  const dataDir = parsePgliteDataDir(connStr);
  return path.isAbsolute(dataDir) ? dataDir : path.resolve(process.cwd(), dataDir);
};
