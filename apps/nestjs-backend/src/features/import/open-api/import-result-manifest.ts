export interface IImportResultManifest {
  successCount: number;
  failedCount: number;
  errorFilePaths: string[];
  fieldNames: string[];
  maxWidth: number;
  errorReportUrl?: string;
}

export const IMPORT_RESULT_MANIFEST_TTL_SECONDS = 60 * 60;
export const IMPORT_LATEST_JOB_TTL_SECONDS = 60 * 60;
const importResultManifestPrefix = 'import:result:manifest:';
const importLatestJobPrefix = 'import:latest-job:';

export const getImportResultManifestKey = (jobId: string): `import:result:manifest:${string}` =>
  `${importResultManifestPrefix}${jobId}` as `import:result:manifest:${string}`;

export const getImportLatestJobKey = (tableId: string): `import:latest-job:${string}` =>
  `${importLatestJobPrefix}${tableId}` as `import:latest-job:${string}`;
