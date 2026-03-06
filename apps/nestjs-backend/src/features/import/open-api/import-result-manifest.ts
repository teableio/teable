export interface IImportResultManifest {
  successCount: number;
  failedCount: number;
  errorFilePaths: string[];
  fieldNames: string[];
  maxWidth: number;
}

export const IMPORT_RESULT_MANIFEST_TTL_SECONDS = 60 * 60;
const importResultManifestPrefix = 'import:result:manifest:';

export const getImportResultManifestKey = (jobId: string): `import:result:manifest:${string}` =>
  `${importResultManifestPrefix}${jobId}` as `import:result:manifest:${string}`;
