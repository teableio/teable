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
  /** Async row iterator for incremental parsing; consumers close it when stopping early. */
  readonly rowsAsync?: AsyncIterable<ReadonlyArray<unknown>>;
  /** Available sheets (for Excel files) */
  readonly sheets?: ReadonlyArray<{ name: string; index: number }>;
  /** Currently selected sheet */
  readonly currentSheet?: string;
  /**
   * Number of rows in `rows` / `rowsAsync` when known up front.
   * Includes a header row when the adapter yields it as the first row.
   */
  readonly rowCount?: number;
  /** Original 1-based source position, including the header, without retaining streamed rows. */
  readonly getSourceRowNumber?: (row: ReadonlyArray<unknown>) => number | undefined;
}

/** Counts cover all observed invalid cells, including cells in subsequently skipped rows. */
export interface IImportDiagnostics {
  readonly invalidDateCells: number;
  readonly skippedRows: number;
  /** At most 100 samples per table/import; never includes raw cell values. */
  readonly samples: ReadonlyArray<{
    readonly rowNumber: number;
    readonly fieldId?: string;
    readonly fieldName?: string;
    readonly reason: 'invalidDate' | 'invalidRow';
    readonly code: string;
    readonly message: string;
  }>;
}

/**
 * Progress information during import.
 */
export interface IImportProgress {
  phase: 'parsing' | 'inserting' | 'completed' | 'failed';
  processedRows: number;
  currentBatch: number;
  /** Total data rows for this table/sheet when known. */
  totalRows?: number;
  error?: string;
  /** Final committed outcome only; intermediate progress never carries diagnostics. */
  diagnostics?: IImportDiagnostics;
}

/**
 * Options for import operations.
 */
export interface IImportOptions {
  /** Number of records per batch (default: 500) */
  batchSize?: number;
  /** Maximum source data rows after header skipping, including rows rejected by field validation. */
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
  /**
   * Stage a URL source before parsing (default: true). Bounded previews set
   * false so they read only the sample and cancel the response body.
   */
  snapshotSource?: boolean;
}

/**
 * Maps field IDs to source column indices.
 * null means skip this field.
 */
export type SourceColumnMap = Record<string, number | null>;
