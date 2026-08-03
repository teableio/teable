import type { PassThrough, Readable } from 'stream';
import Papa from 'papaparse';

export interface IImportError {
  rowIndex: number;
  originalData: unknown[];
  errorMessage: string;
  /** Field name(s) that caused the error, identified by the child processor */
  failedFieldNames?: string[];
}

export interface IImportStats {
  success: number;
  failed: number;
  total: number;
}

export interface IUploadResult {
  path: string;
}

export class ImportErrorCollector {
  private errors: IImportError[] = [];
  private _successCount = 0;
  private _failedCount = 0;
  private _fieldNames: string[] = [];
  private _streamWriter: StreamingErrorReportWriter | null = null;

  constructor(fieldNames?: string[]) {
    this._fieldNames = fieldNames ?? [];
  }

  setFieldNames(names: string[]): void {
    this._fieldNames = names;
  }

  /**
   * Enable streaming mode: errors are written to a PassThrough stream as they arrive,
   * and the stream is uploaded directly to object storage (S3/MinIO). No temp file,
   * no local disk usage - suitable for serverless and restricted environments.
   *
   * @param stream PassThrough stream - we write CSV to it, upload reads from it.
   * @param maxWidth Maximum number of columns for the CSV header (from field mapping).
   * @param startUpload Called when the first error arrives - starts the upload. Returns promise with path.
   */
  enableStreamingToStorage(
    stream: PassThrough,
    maxWidth: number,
    startUpload: (stream: PassThrough) => Promise<IUploadResult>
  ): void {
    this._streamWriter = new StreamingErrorReportWriter(
      stream,
      this._fieldNames,
      maxWidth,
      startUpload
    );
  }

  add(error: IImportError): void {
    this._failedCount++;
    if (this._streamWriter) {
      this._streamWriter.appendError(error);
    } else {
      this.errors.push(error);
    }
  }

  addSuccessCount(count: number): void {
    this._successCount += count;
  }

  addFailedCount(count: number): void {
    this._failedCount += count;
  }

  hasErrors(): boolean {
    return this._failedCount > 0;
  }

  get successCount(): number {
    return this._successCount;
  }

  get failedCount(): number {
    return this._failedCount;
  }

  get isTruncated(): boolean {
    return !this._streamWriter && this._failedCount > this.errors.length;
  }

  getStats(): IImportStats {
    return {
      success: this._successCount,
      failed: this._failedCount,
      total: this._successCount + this._failedCount,
    };
  }

  getErrors(): readonly IImportError[] {
    return this.errors;
  }

  /**
   * End the stream and return the upload promise. Call when all chunks are processed.
   * Resolves to the upload result (with path) when the stream has been fully consumed.
   */
  async closeStream(): Promise<IUploadResult | undefined> {
    if (this._streamWriter) {
      const result = await this._streamWriter.close();
      this._streamWriter = null;
      return result;
    }
    return undefined;
  }

  /**
   * Generate a CSV error report with BOM header for Excel compatibility.
   * Only used when NOT in streaming mode (errors held in memory).
   */
  generateCsvReport(): string {
    if (this._streamWriter) {
      throw new Error('generateCsvReport cannot be used in streaming mode');
    }
    if (this.errors.length === 0) {
      return '';
    }

    const sorted = [...this.errors].sort((a, b) => a.rowIndex - b.rowIndex);
    const maxWidth = Math.max(
      this._fieldNames.length,
      ...sorted.map((e) => (Array.isArray(e.originalData) ? e.originalData.length : 0))
    );
    const headers = Array.from(
      { length: maxWidth },
      (_, i) => this._fieldNames[i] || `Column ${i + 1}`
    );
    const headerRow = [...headers, '__error'];
    const dataRows = sorted.map((error) => {
      const originalCells = Array.isArray(error.originalData) ? error.originalData : [];
      const padded = [...originalCells];
      while (padded.length < maxWidth) padded.push('');
      return [...padded, error.errorMessage];
    });
    const csvString = Papa.unparse({ fields: headerRow, data: dataRows });
    return '\uFEFF' + csvString;
  }

  /**
   * Pipe a Readable stream of pre-formatted CSV data rows (no header) into
   * the error report stream. Backpressure is handled automatically via
   * stream.pipeline. Avoids buffering the entire chunk error file in memory.
   */
  async pipeRawCsvStream(source: Readable, failedCount: number): Promise<void> {
    this._failedCount += failedCount;
    if (this._streamWriter) {
      await this._streamWriter.pipeFrom(source);
    }
  }

  merge(other: ImportErrorCollector): void {
    for (const err of other.getErrors()) {
      this.add(err);
    }
    const otherTruncatedCount = other.failedCount - other.getErrors().length;
    if (otherTruncatedCount > 0) {
      this._failedCount += otherTruncatedCount;
    }
    this._successCount += other.successCount;
  }

  reset(): void {
    this.errors = [];
    this._successCount = 0;
    this._failedCount = 0;
  }
}

/**
 * Streams error rows to a PassThrough as they arrive. Upload reads from the same stream.
 * S3/MinIO support streaming upload natively - no temp file needed.
 */
class StreamingErrorReportWriter {
  private stream: PassThrough;
  private fieldNames: string[];
  private maxWidth: number;
  private startUpload: (stream: PassThrough) => Promise<IUploadResult>;
  private uploadPromise: Promise<IUploadResult> | null = null;

  constructor(
    stream: PassThrough,
    fieldNames: string[],
    maxWidth: number,
    startUpload: (stream: PassThrough) => Promise<IUploadResult>
  ) {
    this.stream = stream;
    this.fieldNames = fieldNames;
    this.maxWidth = Math.max(maxWidth, 1);
    this.startUpload = startUpload;
  }

  appendError(error: IImportError): void {
    if (!this.uploadPromise) {
      this.writeHeader();
      this.uploadPromise = this.startUpload(this.stream);
    }
    const originalCells = Array.isArray(error.originalData) ? error.originalData : [];
    const padded = [...originalCells];
    while (padded.length < this.maxWidth) padded.push('');
    const row = [...padded, error.errorMessage];
    const line = Papa.unparse([row], { header: false });
    this.stream.write(line.endsWith('\n') ? line : line + '\n');
  }

  /**
   * Pipe a Readable (e.g. S3 download stream) into the report stream.
   * Uses `.pipe({ end: false })` so the destination stays open for subsequent chunks.
   * Backpressure is handled by Node's built-in pipe mechanism.
   * On source error we unpipe without destroying the destination.
   */
  async pipeFrom(source: Readable): Promise<void> {
    this.ensureHeaderWritten();
    return new Promise<void>((resolve, reject) => {
      source.on('end', () => {
        source.unpipe(this.stream);
        resolve();
      });
      source.on('error', (err) => {
        source.unpipe(this.stream);
        reject(err);
      });
      source.pipe(this.stream, { end: false });
    });
  }

  private ensureHeaderWritten(): void {
    if (!this.uploadPromise) {
      this.writeHeader();
      this.uploadPromise = this.startUpload(this.stream);
    }
  }

  private writeHeader(): void {
    const headers = Array.from(
      { length: this.maxWidth },
      (_, i) => this.fieldNames[i] || `Column ${i + 1}`
    );
    const headerRow = [...headers, '__error'];
    const headerLine = '\uFEFF' + Papa.unparse({ fields: headerRow, data: [] }).trimEnd() + '\n';
    this.stream.write(headerLine);
  }

  async close(): Promise<IUploadResult | undefined> {
    this.stream.end();
    return this.uploadPromise ?? undefined;
  }
}
