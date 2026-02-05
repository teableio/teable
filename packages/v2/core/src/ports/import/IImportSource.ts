/**
 * Type identifier for import sources (e.g., 'csv', 'xlsx', 'excel')
 */
export type ImportSourceType = string;

/**
 * Represents an import data source.
 * Can be URL, raw data, or stream.
 */
export interface IImportSource {
  /** Source type identifier (e.g., 'csv', 'xlsx') */
  readonly type: ImportSourceType;
  /** URL to fetch data from */
  readonly url?: string;
  /** Raw data (binary or string) */
  readonly data?: Uint8Array | string;
  /** Async stream of data chunks */
  readonly stream?: AsyncIterable<Uint8Array | string>;
  /** Original file name (for type detection) */
  readonly fileName?: string;
  /** Additional adapter-specific options */
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * Result of parsing an import source.
 */
export interface IImportParseResult {
  /** Column headers from the source */
  readonly headers: ReadonlyArray<string>;
  /** Synchronous row iterator (for in-memory data) */
  readonly rows?: Iterable<ReadonlyArray<unknown>>;
  /** Asynchronous row iterator (for streaming/URL sources) */
  readonly rowsAsync?: AsyncIterable<ReadonlyArray<unknown>>;
  /** Available sheets (for Excel files) */
  readonly sheets?: ReadonlyArray<{ name: string; index: number }>;
  /** Currently selected sheet */
  readonly currentSheet?: string;
}

/**
 * Progress information during import.
 */
export interface IImportProgress {
  phase: 'parsing' | 'inserting' | 'completed' | 'failed';
  processedRows: number;
  currentBatch: number;
  error?: string;
}

/**
 * Options for import operations.
 */
export interface IImportOptions {
  /** Number of records per batch (default: 500) */
  batchSize?: number;
  /** Maximum number of data rows to import (after skipping) */
  maxRowCount?: number;
  /** Skip first N lines (e.g., for header row) */
  skipFirstNLines?: number;
  /** Sheet name for Excel files */
  sheetName?: string;
  /** Progress callback */
  onProgress?: (progress: IImportProgress) => void;
  /** CSV delimiter */
  delimiter?: string;
  /** Enable type casting (default: true) */
  typecast?: boolean;
}

/**
 * Maps field IDs to source column indices.
 * null means skip this field.
 */
export type SourceColumnMap = Record<string, number | null>;
