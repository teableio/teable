/* eslint-disable sonarjs/cognitive-complexity */
import type { IAttachmentCellValue, IFieldVo, IFilter } from '@teable/core';
import { FieldKeyType, FieldType, mergeFilter } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import {
  getRecords,
  getRowCount,
  getShareViewRecords,
  getShareViewRowCount,
} from '@teable/openapi';
import type { IFieldInstance } from '@teable/sdk';

/**
 * Check if should disable cache for this mimetype to avoid CORS issues.
 * Media types (image/video/audio) may be cached by browser via native tags without CORS headers.
 * Returns true (disable cache) if mimetype is media type or invalid.
 */
const shouldDisableCache = (mimetype: string | undefined, fileName: string): boolean => {
  if (!mimetype || typeof mimetype !== 'string') {
    console.error(`Invalid mimetype for: ${fileName}, using no-store fallback`);
    return true;
  }
  return (
    mimetype.startsWith('image/') || mimetype.startsWith('video/') || mimetype.startsWith('audio/')
  );
};

export interface IDownloadProgress {
  downloaded: number;
  total: number;
  currentFileName: string;
  percent: number;
}

export interface IDownloadAllAttachmentsOptions {
  tableId: string;
  fieldId: string;
  fieldName: string;
  viewId?: string;
  shareId?: string;
  personalViewCommonQuery?: IGetRecordsRo;
  namingField?: IFieldInstance;
  groupByRow?: boolean;
  onProgress?: (progress: IDownloadProgress) => void;
  abortController?: AbortController;
}

/**
 * Field types suitable for naming files
 * These are fields that can produce meaningful text values for file names
 */
const NAMING_SUITABLE_FIELD_TYPES: FieldType[] = [
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Number,
  FieldType.AutoNumber,
  FieldType.SingleSelect,
  FieldType.Date,
  FieldType.Formula,
  FieldType.Rollup,
];

/**
 * Check if a field is suitable for naming files
 */
export function isFieldSuitableForNaming(field: IFieldVo): boolean {
  return NAMING_SUITABLE_FIELD_TYPES.includes(field.type as FieldType);
}

export interface IDownloadCellAttachmentsOptions {
  attachments: IAttachmentCellValue;
  zipFileName?: string;
  onProgress?: (progress: IDownloadProgress) => void;
  abortController?: AbortController;
}

export interface IDownloadResult {
  success: boolean;
  totalFiles: number;
  failedFiles: string[];
  cancelled?: boolean;
}

export interface IAttachmentPreview {
  rowsWithAttachments: number;
  totalAttachments: number;
  totalSize: number;
}

interface IAttachmentWithRowIndex {
  rowIndex: number;
  attachmentIndex: number;
  attachment: IAttachmentCellValue[number];
  namingValue?: string;
  rowAttachmentCount: number; // Total attachments in this row (for groupByRow feature)
}

const PAGE_SIZE = 100;
const DOWNLOAD_CANCELLED_MESSAGE = 'Download cancelled';

/**
 * Format bytes to human readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Create a filter that combines personal view filter with non-empty attachment filter
 */
function createAttachmentFilter(fieldId: string, existingFilter?: IFilter): IFilter {
  // Non-empty filter for attachment field
  const nonEmptyFilter: IFilter = {
    conjunction: 'and',
    filterSet: [
      {
        fieldId,
        operator: 'isNotEmpty',
        value: null,
      },
    ],
  };

  // Merge with existing filter if provided
  return mergeFilter(existingFilter, nonEmptyFilter, 'and') ?? nonEmptyFilter;
}

/**
 * Sanitize string for use as filename
 * Remove or replace characters that are not allowed in file names
 */
function sanitizeForFilename(str: string): string {
  // Replace characters not allowed in filenames with underscore
  return str
    .replace(/[<>:"/\\|?*]/g, '_') // Replace illegal characters
    .replace(/\s+/g, '_') // Replace whitespace with underscore
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_+|_+$/g, '') // Trim leading/trailing underscores
    .slice(0, 100); // Limit length to 100 characters
}

/**
 * Load all attachments from records with pagination
 */
async function loadAllAttachments(
  tableId: string,
  fieldId: string,
  viewId?: string,
  shareId?: string,
  personalViewCommonQuery?: IGetRecordsRo,
  abortSignal?: AbortSignal,
  namingField?: IFieldInstance
): Promise<{
  attachments: IAttachmentWithRowIndex[];
  rowsWithAttachments: number;
  totalAttachments: number;
  totalSize: number;
}> {
  const { ignoreViewQuery, filter, orderBy, groupBy } = personalViewCommonQuery ?? {};

  // 1. Create filter with non-empty attachment condition
  const attachmentFilter = createAttachmentFilter(fieldId, filter as IFilter | undefined);

  // 2. Get total row count with the filter (use share view API if shareId is provided)
  const rowCountData = shareId
    ? (await getShareViewRowCount(shareId, { filter: attachmentFilter })).data
    : (
        await getRowCount(tableId, {
          viewId,
          ...(ignoreViewQuery ? { ignoreViewQuery } : {}),
          filter: attachmentFilter,
        })
      ).data;

  const totalRows = rowCountData.rowCount;

  if (totalRows === 0) {
    return {
      attachments: [],
      rowsWithAttachments: 0,
      totalAttachments: 0,
      totalSize: 0,
    };
  }

  // 3. Build projection - include naming field if specified
  const projection = namingField ? [fieldId, namingField.id] : [fieldId];

  // 4. Load all records with pagination
  const attachments: IAttachmentWithRowIndex[] = [];
  let rowsWithAttachments = 0;
  let totalAttachments = 0;
  let totalSize = 0;
  let rowIndex = 1;

  for (let skip = 0; skip < totalRows; skip += PAGE_SIZE) {
    if (abortSignal?.aborted) {
      throw new DOMException(DOWNLOAD_CANCELLED_MESSAGE, 'AbortError');
    }

    const query: IGetRecordsRo = {
      viewId,
      take: PAGE_SIZE,
      skip,
      fieldKeyType: FieldKeyType.Id,
      projection,
      filter: attachmentFilter,
      ...(ignoreViewQuery ? { ignoreViewQuery } : {}),
      ...(orderBy ? { orderBy } : {}),
      ...(groupBy ? { groupBy } : {}),
    };

    // Use share view API if shareId is provided
    const { data } = shareId
      ? await getShareViewRecords(shareId, query)
      : await getRecords(tableId, query);
    const records = data.records;

    if (!records?.length) break;

    for (const record of records) {
      const cellValue = record.fields[fieldId] as IAttachmentCellValue | undefined;
      if (cellValue && Array.isArray(cellValue) && cellValue.length > 0) {
        // Filter attachments with valid presignedUrl (non-empty string)
        const downloadableAttachments = cellValue.filter(
          (a) => a.presignedUrl && typeof a.presignedUrl === 'string' && a.presignedUrl.trim()
        );
        if (downloadableAttachments.length > 0) {
          rowsWithAttachments++;
          totalAttachments += downloadableAttachments.length;
          totalSize += downloadableAttachments.reduce((sum, a) => sum + (a.size || 0), 0);

          // Get naming value using field's cellValue2String method
          let namingValue: string | undefined;
          if (namingField) {
            const namingCellValue = record.fields[namingField.id];
            const rawValue = namingField.cellValue2String(namingCellValue);
            namingValue = rawValue ? sanitizeForFilename(rawValue) : undefined;
          }

          const rowAttachmentCount = downloadableAttachments.length;
          downloadableAttachments.forEach((attachment, attachmentIndex) => {
            attachments.push({
              rowIndex,
              attachmentIndex,
              attachment,
              namingValue,
              rowAttachmentCount,
            });
          });
        }
      }
      rowIndex++;
    }
  }

  return {
    attachments,
    rowsWithAttachments,
    totalAttachments,
    totalSize,
  };
}

/**
 * Get preview info for download dialog (row count, attachment count, total size)
 */
export async function getAttachmentPreview(
  tableId: string,
  fieldId: string,
  viewId?: string,
  shareId?: string,
  personalViewCommonQuery?: IGetRecordsRo
): Promise<IAttachmentPreview> {
  const { rowsWithAttachments, totalAttachments, totalSize } = await loadAllAttachments(
    tableId,
    fieldId,
    viewId,
    shareId,
    personalViewCommonQuery
  );

  return { rowsWithAttachments, totalAttachments, totalSize };
}

/**
 * Get padded row number based on total records
 */
function getPaddedRowNumber(rowIndex: number, totalRows: number): string {
  const digits = Math.max(3, String(totalRows).length);
  return String(rowIndex).padStart(digits, '0');
}

/**
 * Generate folder name for groupByRow feature
 */
function generateFolderName(
  rowIndex: number,
  totalRows: number,
  namingValue?: string,
  isNamingValueDuplicated?: boolean
): string {
  if (namingValue) {
    if (isNamingValueDuplicated) {
      return `${namingValue}_${getPaddedRowNumber(rowIndex, totalRows)}`;
    }
    return namingValue;
  }
  return getPaddedRowNumber(rowIndex, totalRows);
}

/**
 * Generate unique filename for attachment within zip
 * When namingValue is provided and is unique, use simple format: namingValue_fileName
 * When namingValue is duplicated, add row number: namingValue_rowNumber_fileName
 * When no namingValue, use row number as prefix
 *
 * When groupByRow is enabled and row has multiple attachments:
 * - Put files in a folder named after the row
 * - Use original filename (with index suffix if duplicated)
 */
function generateZipFileName(
  rowIndex: number,
  attachmentIndex: number,
  fileName: string,
  totalRows: number,
  rowAttachmentCount: number,
  namingValue?: string,
  isNamingValueDuplicated?: boolean,
  groupByRow?: boolean
): string {
  const hasMultipleInRow = rowAttachmentCount > 1;

  // When groupByRow is enabled and row has multiple attachments, use folder structure
  if (groupByRow && hasMultipleInRow) {
    const folderName = generateFolderName(
      rowIndex,
      totalRows,
      namingValue,
      isNamingValueDuplicated
    );
    // Use original filename, add index suffix to avoid duplicates within same row
    return `${folderName}/${attachmentIndex + 1}_${fileName}`;
  }

  // Original flat structure
  let prefix: string;

  if (namingValue) {
    // Has naming value: add row number only if duplicated
    if (isNamingValueDuplicated) {
      prefix = `${namingValue}_${getPaddedRowNumber(rowIndex, totalRows)}`;
    } else {
      prefix = namingValue;
    }
  } else {
    // No naming value: use row number
    prefix = getPaddedRowNumber(rowIndex, totalRows);
  }

  if (hasMultipleInRow) {
    return `${prefix}_${attachmentIndex + 1}_${fileName}`;
  }
  return `${prefix}_${fileName}`;
}

/**
 * Download all attachments and compress into a zip file
 * Uses streaming to avoid memory issues with large files
 */
export async function downloadAllAttachments(
  options: IDownloadAllAttachmentsOptions
): Promise<IDownloadResult> {
  const {
    tableId,
    fieldId,
    fieldName,
    viewId,
    shareId,
    personalViewCommonQuery,
    namingField,
    groupByRow,
    onProgress,
    abortController,
  } = options;

  const abortSignal = abortController?.signal;
  const failedFiles: string[] = [];

  try {
    // 1. Load all attachments
    const { attachments: attachmentList, totalSize } = await loadAllAttachments(
      tableId,
      fieldId,
      viewId,
      shareId,
      personalViewCommonQuery,
      abortSignal,
      namingField
    );

    if (attachmentList.length === 0) {
      return { success: true, totalFiles: 0, failedFiles: [] };
    }

    // 2. Get max row index for padding
    const maxRowIndex = Math.max(...attachmentList.map((a) => a.rowIndex));

    // 3. Count naming values to detect duplicates (only count unique rows per naming value)
    const namingValueRowCount = new Map<string, Set<number>>();
    attachmentList.forEach(({ rowIndex, namingValue }) => {
      if (namingValue) {
        if (!namingValueRowCount.has(namingValue)) {
          namingValueRowCount.set(namingValue, new Set());
        }
        namingValueRowCount.get(namingValue)!.add(rowIndex);
      }
    });
    // A naming value is duplicated if it appears in more than one row
    const duplicatedNamingValues = new Set<string>();
    namingValueRowCount.forEach((rows, namingValue) => {
      if (rows.size > 1) {
        duplicatedNamingValues.add(namingValue);
      }
    });

    // 4. Dynamic import streaming libraries (not loaded until needed)
    const [{ Zip, ZipPassThrough }, streamSaverModule] = await Promise.all([
      import('fflate'),
      import('streamsaver'),
    ]);
    // streamsaver uses CommonJS, access default export
    const streamSaver = streamSaverModule.default ?? streamSaverModule;

    // Configure StreamSaver to use local service worker
    if (typeof window !== 'undefined') {
      streamSaver.mitm = `${window.location.origin}/streamsaver/mitm.html?version=2.0.0`;
    }

    // 5. Create file write stream
    const zipFileName = `${fieldName}_attachments.zip`;
    const fileStream = streamSaver.createWriteStream(zipFileName);
    const writer = fileStream.getWriter();

    let downloadedBytes = 0;
    let processedFiles = 0;

    // 6. Create zip stream
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        writer.abort();
        throw err;
      }
      writer.write(chunk);
      if (final) {
        writer.close();
      }
    });

    // 7. Process each attachment
    for (const {
      rowIndex,
      attachmentIndex,
      attachment,
      namingValue,
      rowAttachmentCount: attachmentCountInRow,
    } of attachmentList) {
      if (abortSignal?.aborted) {
        zip.end();
        throw new DOMException(DOWNLOAD_CANCELLED_MESSAGE, 'AbortError');
      }

      const isNamingValueDuplicated = namingValue ? duplicatedNamingValues.has(namingValue) : false;
      const fileName = generateZipFileName(
        rowIndex,
        attachmentIndex,
        attachment.name,
        maxRowIndex,
        attachmentCountInRow,
        namingValue,
        isNamingValueDuplicated,
        groupByRow
      );

      // Skip attachments without valid presignedUrl
      if (!attachment.presignedUrl) {
        failedFiles.push(attachment.name);
        continue;
      }

      // Update progress with current file name
      onProgress?.({
        downloaded: downloadedBytes,
        total: totalSize,
        currentFileName: attachment.name,
        percent: totalSize > 0 ? Math.round((downloadedBytes / totalSize) * 100) : 0,
      });

      // Create a passthrough for this file (no compression for speed)
      const file = new ZipPassThrough(fileName);
      zip.add(file);

      try {
        const disableCache = shouldDisableCache(attachment.mimetype, attachment.name);
        const response = await fetch(attachment.presignedUrl, {
          signal: abortSignal,
          ...(disableCache && { cache: 'no-store' }),
        });

        if (!response.ok) {
          failedFiles.push(attachment.name);
          file.push(new Uint8Array(0), true);
          continue;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          failedFiles.push(attachment.name);
          file.push(new Uint8Array(0), true);
          continue;
        }

        // Stream the file content
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            file.push(new Uint8Array(0), true);
            break;
          }
          file.push(value);
          downloadedBytes += value.length;

          // Update progress
          onProgress?.({
            downloaded: downloadedBytes,
            total: totalSize,
            currentFileName: attachment.name,
            percent: totalSize > 0 ? Math.round((downloadedBytes / totalSize) * 100) : 0,
          });
        }

        processedFiles++;
      } catch (error) {
        // Always close the file entry in case of error
        file.push(new Uint8Array(0), true);

        if ((error as Error).name === 'AbortError') {
          throw error;
        }
        console.error(`Fetch error for: ${attachment.name}`, error);
        failedFiles.push(attachment.name);
      }
    }

    // Finalize zip
    zip.end();

    return {
      success: failedFiles.length === 0,
      totalFiles: processedFiles,
      failedFiles,
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return {
        success: false,
        totalFiles: 0,
        failedFiles,
        cancelled: true,
      };
    }
    throw error;
  }
}

/**
 * Check if streaming download is available (requires HTTPS or localhost)
 */
export function isStreamingDownloadAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return !!navigator.serviceWorker;
}

/**
 * Download a single attachment directly
 */
export function downloadSingleAttachment(
  attachment: IAttachmentCellValue[number],
  isMobile: boolean = false
): void {
  if (!attachment.presignedUrl) return;

  const downloadLink = document.createElement('a');
  downloadLink.href = attachment.presignedUrl;
  downloadLink.target = isMobile ? '_self' : '_blank';
  downloadLink.download = attachment.name;
  downloadLink.click();
}

/**
 * Generate unique filename handling duplicates
 */
function generateUniqueFileName(fileName: string, filenameCount: Map<string, number>): string {
  const count = filenameCount.get(fileName) || 0;
  filenameCount.set(fileName, count + 1);

  if (count === 0) {
    return fileName;
  }

  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex > 0) {
    return `${fileName.slice(0, lastDotIndex)}_${count}${fileName.slice(lastDotIndex)}`;
  }
  return `${fileName}_${count}`;
}

/**
 * Stream attachments into a zip file
 * Shared logic for both column and cell downloads
 */
async function streamAttachmentsToZip(
  attachments: Array<{
    fileName: string;
    url: string;
    originalName: string;
    size: number;
    mimetype: string;
  }>,
  zipFileName: string,
  totalSize: number,
  onProgress?: (progress: IDownloadProgress) => void,
  abortSignal?: AbortSignal
): Promise<IDownloadResult> {
  const failedFiles: string[] = [];

  // Dynamic import streaming libraries
  const [{ Zip, ZipPassThrough }, streamSaverModule] = await Promise.all([
    import('fflate'),
    import('streamsaver'),
  ]);
  const streamSaver = streamSaverModule.default ?? streamSaverModule;

  // Configure StreamSaver to use local service worker
  if (typeof window !== 'undefined') {
    streamSaver.mitm = `${window.location.origin}/streamsaver/mitm.html?version=2.0.0`;
  }

  // Create file write stream
  const fileStream = streamSaver.createWriteStream(zipFileName);
  const writer = fileStream.getWriter();

  let downloadedBytes = 0;
  let processedFiles = 0;

  // Create zip stream
  const zip = new Zip((err: Error | null, chunk: Uint8Array, final: boolean) => {
    if (err) {
      writer.abort();
      throw err;
    }
    writer.write(chunk);
    if (final) {
      writer.close();
    }
  });

  // Process each attachment
  for (const { fileName, url, originalName, mimetype } of attachments) {
    if (abortSignal?.aborted) {
      zip.end();
      throw new DOMException(DOWNLOAD_CANCELLED_MESSAGE, 'AbortError');
    }

    // Update progress
    onProgress?.({
      downloaded: downloadedBytes,
      total: totalSize,
      currentFileName: originalName,
      percent: totalSize > 0 ? Math.round((downloadedBytes / totalSize) * 100) : 0,
    });

    const file = new ZipPassThrough(fileName);
    zip.add(file);

    try {
      const disableCache = shouldDisableCache(mimetype, originalName);
      const response = await fetch(url, {
        signal: abortSignal,
        ...(disableCache && { cache: 'no-store' }),
      });

      if (!response.ok) {
        failedFiles.push(originalName);
        file.push(new Uint8Array(0), true);
        continue;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        failedFiles.push(originalName);
        file.push(new Uint8Array(0), true);
        continue;
      }

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          file.push(new Uint8Array(0), true);
          break;
        }
        file.push(value);
        downloadedBytes += value.length;

        onProgress?.({
          downloaded: downloadedBytes,
          total: totalSize,
          currentFileName: originalName,
          percent: totalSize > 0 ? Math.round((downloadedBytes / totalSize) * 100) : 0,
        });
      }

      processedFiles++;
    } catch (error) {
      file.push(new Uint8Array(0), true);

      if ((error as Error).name === 'AbortError') {
        throw error;
      }
      console.error(`Fetch error for: ${originalName}`, error);
      failedFiles.push(originalName);
    }
  }

  zip.end();

  return {
    success: failedFiles.length === 0,
    totalFiles: processedFiles,
    failedFiles,
  };
}

/**
 * Download cell attachments as a zip file
 * For single cell download in expand record view
 */
export async function downloadCellAttachments(
  options: IDownloadCellAttachmentsOptions
): Promise<IDownloadResult> {
  const { attachments, zipFileName = 'attachments.zip', onProgress, abortController } = options;

  const abortSignal = abortController?.signal;

  // Filter valid attachments
  const validAttachments = attachments.filter(
    (a) => a.presignedUrl && typeof a.presignedUrl === 'string' && a.presignedUrl.trim()
  );

  if (validAttachments.length === 0) {
    return { success: true, totalFiles: 0, failedFiles: [] };
  }

  const totalSize = validAttachments.reduce((sum, a) => sum + (a.size || 0), 0);
  const filenameCount = new Map<string, number>();

  // Prepare attachment list with unique filenames
  const attachmentList = validAttachments.map((a) => ({
    fileName: generateUniqueFileName(a.name, filenameCount),
    url: a.presignedUrl!,
    originalName: a.name,
    size: a.size || 0,
    mimetype: a.mimetype,
  }));

  try {
    return await streamAttachmentsToZip(
      attachmentList,
      zipFileName,
      totalSize,
      onProgress,
      abortSignal
    );
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return {
        success: false,
        totalFiles: 0,
        failedFiles: [],
        cancelled: true,
      };
    }
    throw error;
  }
}
