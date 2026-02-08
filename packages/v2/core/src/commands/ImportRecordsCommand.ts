import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import type { IImportSource, IImportOptions, SourceColumnMap } from '../ports/import/IImportSource';

/**
 * Zod schema for ImportRecords HTTP API input.
 * Supports CSV data string or URL.
 */
export const importRecordsInputSchema = z.object({
  tableId: z.string(),
  fileType: z.enum(['csv', 'tsv', 'txt', 'xlsx', 'xls', 'excel']),
  sourceColumnMap: z.record(z.string(), z.number().nullable()),
  options: z
    .object({
      batchSize: z.number().min(1).max(5000).optional(),
      maxRowCount: z.number().min(0).optional(),
      skipFirstNLines: z.number().min(0).optional(),
      sheetName: z.string().optional(),
      typecast: z.boolean().optional(),
      delimiter: z.string().optional(),
    })
    .optional(),
  // Either csvData or url must be provided
  csvData: z.string().optional(),
  url: z.string().url().optional(),
});

export type IImportRecordsCommandInput = z.input<typeof importRecordsInputSchema>;

/**
 * Command for importing records into an existing table.
 *
 * This command supports:
 * - CSV, Excel and other formats via adapters
 * - Streaming parsing from URL sources
 * - Typecast with automatic select option creation
 * - Link field resolution
 */
export class ImportRecordsCommand {
  private constructor(
    readonly tableId: TableId,
    readonly source: IImportSource,
    readonly sourceColumnMap: SourceColumnMap,
    readonly options: IImportOptions
  ) {}

  /**
   * Create command from raw input with validation.
   */
  static create(input: {
    tableId: string;
    source: IImportSource;
    sourceColumnMap: SourceColumnMap;
    options?: IImportOptions;
  }): Result<ImportRecordsCommand, DomainError> {
    const tableIdResult = TableId.create(input.tableId);
    if (tableIdResult.isErr()) {
      return err(tableIdResult.error);
    }

    if (!input.source.type) {
      return err(
        domainError.validation({
          message: 'Import source type is required',
          code: 'import.source_type_required',
        })
      );
    }

    if (!input.source.url && !input.source.data && !input.source.stream) {
      return err(
        domainError.validation({
          message: 'Import source must have url, data, or stream',
          code: 'import.source_required',
        })
      );
    }

    const options = input.options ?? {};
    if (options.batchSize !== undefined && (options.batchSize < 1 || options.batchSize > 5000)) {
      return err(
        domainError.validation({
          message: 'batchSize must be between 1 and 5000',
          code: 'import.invalid_batch_size',
        })
      );
    }
    if (options.maxRowCount !== undefined && options.maxRowCount < 0) {
      return err(
        domainError.validation({
          message: 'maxRowCount must be greater than or equal to 0',
          code: 'import.invalid_max_row_count',
        })
      );
    }

    return ok(
      new ImportRecordsCommand(tableIdResult.value, input.source, input.sourceColumnMap, {
        batchSize: options.batchSize ?? 500,
        maxRowCount: options.maxRowCount,
        skipFirstNLines:
          options.skipFirstNLines ?? (shouldSkipHeaderRow(input.source.type ?? '') ? 1 : 0),
        sheetName: options.sheetName,
        typecast: options.typecast ?? true,
        onProgress: options.onProgress,
        delimiter: options.delimiter,
      })
    );
  }

  /**
   * Create command from URL source.
   */
  static createFromUrl(input: {
    tableId: string;
    url: string;
    fileType: string;
    sourceColumnMap: SourceColumnMap;
    options?: IImportOptions;
  }): Result<ImportRecordsCommand, DomainError> {
    return ImportRecordsCommand.create({
      tableId: input.tableId,
      source: {
        type: input.fileType,
        url: input.url,
      },
      sourceColumnMap: input.sourceColumnMap,
      options: input.options,
    });
  }
}

const shouldSkipHeaderRow = (sourceType: string): boolean => {
  const normalized = sourceType.toLowerCase();
  return (
    normalized === 'csv' ||
    normalized === 'tsv' ||
    normalized === 'txt' ||
    normalized === 'xlsx' ||
    normalized === 'xls' ||
    normalized === 'excel'
  );
};
