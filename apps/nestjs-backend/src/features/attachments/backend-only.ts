import { posix } from 'path';
import { UploadType } from '@teable/openapi';
import StorageAdapter from './plugins/adapter';

/** Upload types only the backend writes and reads: cold archives and artifacts. */
export const BACKEND_ONLY_UPLOAD_TYPES: ReadonlySet<UploadType> = new Set([
  UploadType.RecordHistory,
  UploadType.RecordRemoval,
  UploadType.WorkflowRunCold,
  UploadType.AuditLogCold,
  UploadType.Artifact,
]);

/**
 * Private-bucket top-level dirs of the backend-only types. Nothing mints read
 * tokens or signed urls for them (cold archives are consumed server-side,
 * artifacts through downloadFile).
 */
export const BACKEND_ONLY_DIRS: ReadonlySet<string> = new Set(
  [...BACKEND_ONLY_UPLOAD_TYPES].map((type) => StorageAdapter.getDir(type))
);

/**
 * Whether an object key (relative to its bucket) lands in a backend-only dir once
 * `.` and `..` segments are resolved. A stored attachment path is only as
 * trustworthy as whatever wrote the row, so every place that turns one into a
 * download or a signed url asks this first.
 */
export const isBackendOnlyObjectKey = (key: string): boolean => {
  if (typeof key !== 'string') {
    return false;
  }
  const [dir] = posix
    .normalize(`/${key.replaceAll('\\', '/')}`)
    .split('/')
    .filter(Boolean);
  return dir !== undefined && BACKEND_ONLY_DIRS.has(dir);
};

/** A stored path that may be read back or signed: a non-empty key outside the backend-only dirs. */
export const isServableObjectKey = (key: unknown): key is string =>
  typeof key === 'string' && key !== '' && !isBackendOnlyObjectKey(key);

/** The thumbnail paths of a row, without any that points into a backend-only dir. */
export const servableThumbnailPaths = (paths: { sm?: string; lg?: string } | undefined) => ({
  sm: isServableObjectKey(paths?.sm) ? paths?.sm : undefined,
  lg: isServableObjectKey(paths?.lg) ? paths?.lg : undefined,
});
