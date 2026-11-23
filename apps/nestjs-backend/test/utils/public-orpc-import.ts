import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UploadType, analyzeFile, getSignature, notify, uploadFile,
} from '@teable/openapi';
import type { IImportOptionRo } from '@teable/openapi';

/** Upload bytes through the genuine signature/storage/notify API before analysis. */
export const uploadPublicImport = async (
  bytes: string | Buffer,
  filename: string,
  contentType: string,
  fileType: IImportOptionRo['fileType']
): Promise<IImportOptionRo> => {
  const directory = await mkdtemp(join(tmpdir(), 'public-workflow-upload-'));
  const path = join(directory, filename);
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  try {
    await writeFile(path, buffer);
    const { token, requestHeaders } = (await getSignature({
      type: UploadType.Import, contentLength: buffer.length, contentType,
    })).data;
    await uploadFile(token, createReadStream(path), requestHeaders);
    const { presignedUrl: attachmentUrl } = (await notify(token, undefined, filename)).data;
    const { worksheets } = (await analyzeFile({ attachmentUrl, fileType })).data;
    return {
      attachmentUrl, fileType, tz: 'UTC',
      worksheets: Object.fromEntries(Object.entries(worksheets).map(([key, sheet]) => [key, {
        name: sheet.name, columns: sheet.columns.map((column, sourceColumnIndex) => ({ ...column, sourceColumnIndex })),
        useFirstRowAsHeader: true, importData: true,
      }])),
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
};
