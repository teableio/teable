export interface IImportResultManifest {
  successCount: number;
  failedCount: number;
  errorFilePaths: string[];
  fieldNames: string[];
  maxWidth: number;
}

export const IMPORT_RESULT_MANIFEST_TTL_SECONDS = 60 * 60;
const IMPORT_RESULT_MANIFEST_PREFIX = 'import:result:manifest:';

export const getImportResultManifestKey = (jobId: string): `import:result:manifest:${string}` =>
  `${IMPORT_RESULT_MANIFEST_PREFIX}${jobId}` as `import:result:manifest:${string}`;
