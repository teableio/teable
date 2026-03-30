import { isAbsolute, resolve } from 'path';
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

export function extractLocalFilePath(
  fileUrl: string,
  provider: string,
  storageDir: string
): string | null {
  if (provider !== 'local') {
    return null;
  }

  const prefix = READ_PATH + '/';
  let pathname: string;
  try {
    pathname = new URL(fileUrl, 'http://localhost').pathname;
  } catch {
    pathname = fileUrl;
  }

  const prefixIdx = pathname.indexOf(prefix);
  if (prefixIdx === -1) {
    return null;
  }

  const relativePath = decodeURIComponent(pathname.substring(prefixIdx + prefix.length));

  if (relativePath.includes('..') || isAbsolute(relativePath)) {
    return null;
  }

  assertPathWithinStorage(relativePath, storageDir);

  return relativePath;
}
