import { isAbsolute, posix, resolve } from 'node:path';
import { HttpErrorCode } from '@teable/core';
import { READ_PATH } from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';

export function assertPathWithinStorage(relativePath: string, storageDir: string): string {
  if (!relativePath || !storageDir || relativePath.includes('..') || isAbsolute(relativePath)) {
    throw new CustomHttpException('Could not find attachment', HttpErrorCode.VALIDATION_ERROR, {
      localization: {
        i18nKey: 'httpErrors.attachment.invalidPath',
      },
    });
  }

  const resolvedPath = resolve(storageDir, relativePath);
  if (!resolvedPath.startsWith(storageDir + '/')) {
    throw new CustomHttpException('Could not find attachment', HttpErrorCode.VALIDATION_ERROR, {
      localization: {
        i18nKey: 'httpErrors.attachment.invalidPath',
      },
    });
  }

  return resolvedPath;
}

export function validateReadPath(path: string, storageDir: string): void {
  assertPathWithinStorage(path, storageDir);
}

/**
 * Canonical `bucket/path` of a storage object, so a read token minted for an
 * object and a request spelling the same object with `//` or `./` segments
 * compare equal. Callers have already rejected `..` and absolute paths.
 */
export function normalizeObjectPath(path: string): string {
  return posix.normalize(path).replace(/^\/+/, '');
}

export interface ILocalFileRef {
  /** `bucket/path` relative to the storage dir */
  path: string;
  /** the read token the url carried, if any */
  token?: string;
}

export function extractLocalFilePath(
  fileUrl: string,
  provider: string,
  storageDir: string
): ILocalFileRef | null {
  if (provider !== 'local') {
    return null;
  }

  const prefix = READ_PATH + '/';
  let url: URL | undefined;
  try {
    url = new URL(fileUrl, 'http://localhost');
  } catch {
    url = undefined;
  }
  const pathname = url?.pathname ?? fileUrl;

  const prefixIdx = pathname.indexOf(prefix);
  if (prefixIdx === -1) {
    return null;
  }

  const relativePath = decodeURIComponent(pathname.substring(prefixIdx + prefix.length));

  if (relativePath.includes('..') || isAbsolute(relativePath)) {
    return null;
  }

  assertPathWithinStorage(relativePath, storageDir);

  return { path: relativePath, token: url?.searchParams.get('token') ?? undefined };
}
