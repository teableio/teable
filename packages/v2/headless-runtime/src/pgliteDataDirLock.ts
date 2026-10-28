import { mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import lockfile from 'proper-lockfile';

/** A live on-disk PGlite data directory is owned by exactly one process. */
export const PGLITE_DATA_DIR_LOCKED_CODE = 'pglite.data_dir_locked';
/** The lock could not be taken for a reason other than contention (permissions, IO). */
export const PGLITE_DATA_DIR_LOCK_FAILED_CODE = 'pglite.data_dir_lock_failed';

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_UPDATE_MS = 10_000;

export interface IPgliteDataDirLockOptions {
  /** Milliseconds after which an unrefreshed lock is treated as abandoned. */
  staleMs?: number;
  /** Milliseconds between lock refreshes; clamped below `staleMs` by the locker. */
  updateMs?: number;
  /** Marks the runtime unsafe if ownership is lost after acquisition. */
  onCompromised?: (error: Error) => void;
}

export interface IPgliteDataDirLock {
  /** Idempotent: later calls resolve once the first release settles. */
  release(): Promise<void>;
}

/**
 * Another process holds the lock. The message never carries the data directory
 * path: hosts log the path they already know, and error payloads stay stable.
 */
export class PgliteDataDirLockedError extends Error {
  readonly code = PGLITE_DATA_DIR_LOCKED_CODE;

  constructor() {
    super('PGlite data directory is already in use by another process');
    this.name = 'PgliteDataDirLockedError';
  }
}

export class PgliteDataDirLockFailedError extends Error {
  readonly code = PGLITE_DATA_DIR_LOCK_FAILED_CODE;

  constructor(cause: unknown) {
    super('Failed to lock the PGlite data directory', { cause });
    this.name = 'PgliteDataDirLockFailedError';
  }
}

export class PgliteDataDirLockReleasedError extends Error {
  readonly code = 'pglite.data_dir_lock_lost';

  constructor() {
    super('PGlite data directory lock was already released or compromised');
    this.name = 'PgliteDataDirLockReleasedError';
  }
}

const resolveDataDirPath = (dataDir: string): string | undefined => {
  if (dataDir.startsWith('memory://') || dataDir.startsWith('idb://')) return undefined;
  if (dataDir.startsWith('opfs-ahp://')) return undefined;
  if (dataDir.startsWith('file://')) return fileURLToPath(dataDir);
  return dataDir;
};

/**
 * Takes the single-owner lock for a persistent PGlite data directory.
 *
 * In-memory (`memory://`) and browser-indexed (`idb://`) targets have no shared
 * on-disk state, so they resolve to `undefined` without touching the filesystem.
 * A crash leaves the lock directory behind; `staleMs` lets the next process
 * reclaim it instead of blocking forever.
 */
export const acquirePgliteDataDirLock = async (
  dataDir: string,
  options: IPgliteDataDirLockOptions = {}
): Promise<IPgliteDataDirLock | undefined> => {
  const dataDirPath = resolveDataDirPath(dataDir);
  if (!dataDirPath) return undefined;

  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const updateMs = options.updateMs ?? Math.min(DEFAULT_UPDATE_MS, staleMs / 2);
  const onCompromised =
    options.onCompromised ??
    ((error: Error) => {
      throw error;
    });

  let canonicalPath: string;
  try {
    await mkdir(dataDirPath, { recursive: true });
    canonicalPath = await realpath(dataDirPath);
  } catch (error) {
    throw new PgliteDataDirLockFailedError(error);
  }

  let unlock!: () => Promise<void>;
  try {
    unlock = await lockfile.lock(canonicalPath, {
      // `canonicalPath` is already resolved, so the locker must not re-resolve it.
      realpath: false,
      // Single owner: report contention immediately instead of waiting.
      retries: 0,
      stale: staleMs,
      update: updateMs,
      onCompromised,
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ELOCKED'
    ) {
      throw new PgliteDataDirLockedError();
    }
    throw new PgliteDataDirLockFailedError(error);
  }

  let released: Promise<void> | undefined;
  return {
    release(): Promise<void> {
      released ??= unlock().catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ERELEASED'
        ) {
          throw new PgliteDataDirLockReleasedError();
        }
        throw error;
      });
      return released;
    },
  };
};
