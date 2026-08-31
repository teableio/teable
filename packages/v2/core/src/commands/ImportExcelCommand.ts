import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableName } from '../domain/table/TableName';
import type { IImportProgress, IImportSource } from '../ports/import/IImportSource';
import type { ImportCsvColumn } from './ImportCsvCommand';

const importExcelBaseSchema = z.object({
  baseId: z.string(),
  tableName: z.string().optional(),
  importData: z.boolean().default(true),
  useFirstRowAsHeader: z.boolean().default(true),
  batchSize: z.number().min(1).max(5000).default(500),
  maxRowCount: z.number().int().positive().optional(),
  sheetName: z.string().optional(),
  fileType: z.enum(['xlsx', 'xls', 'excel']).default('excel'),
  columns: z
    .array(
      z.object({
        name: z.string(),
        sourceColumnIndex: z.number().int().nonnegative(),
        type: z.string().optional(),
      })
    )
    .optional(),
});

export type ImportExcelColumn = ImportCsvColumn;

export const importExcelInputSchema = z.union([
  importExcelBaseSchema.extend({
    excelData: z.instanceof(Uint8Array),
    excelUrl: z.undefined().optional(),
  }),
  importExcelBaseSchema.extend({
    excelUrl: z.string().url('Invalid Excel URL'),
    excelData: z.undefined().optional(),
  }),
]);

export type IImportExcelCommandInput = z.input<typeof importExcelInputSchema>;

/**
 * Excel 新建表导入 Command。
 *
 * 解析指定 worksheet，创建表，并按现有 CSV 导入语义同步写入数据。
 */
export class ImportExcelCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly source: IImportSource,
    readonly tableName: TableName | undefined,
    readonly importData: boolean,
    readonly batchSize: number,
    readonly maxRowCount: number | undefined,
    readonly useFirstRowAsHeader: boolean,
    readonly columns: ReadonlyArray<ImportExcelColumn> | undefined,
    readonly sheetName: string | undefined,
    readonly onProgress?: (progress: IImportProgress) => void,
    readonly truncateOnRowLimit = false
  ) {}

  withOnProgress(onProgress?: (progress: IImportProgress) => void): ImportExcelCommand {
    return new ImportExcelCommand(
      this.baseId,
      this.source,
      this.tableName,
      this.importData,
      this.batchSize,
      this.maxRowCount,
      this.useFirstRowAsHeader,
      this.columns,
      this.sheetName,
      onProgress,
      this.truncateOnRowLimit
    );
  }

  withTruncateOnRowLimit(truncateOnRowLimit: boolean): ImportExcelCommand {
    return new ImportExcelCommand(
      this.baseId,
      this.source,
      this.tableName,
      this.importData,
      this.batchSize,
      this.maxRowCount,
      this.useFirstRowAsHeader,
      this.columns,
      this.sheetName,
      this.onProgress,
      truncateOnRowLimit
    );
  }

  static create(raw: unknown): Result<ImportExcelCommand, DomainError> {
    const parsed = importExcelInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ImportExcelCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    const {
      baseId,
      tableName,
      importData,
      useFirstRowAsHeader,
      batchSize,
      maxRowCount,
      columns,
      sheetName,
      fileType,
    } = parsed.data;

    if ('excelUrl' in parsed.data && parsed.data.excelUrl) {
      return ImportExcelCommand.createFromUrl({
        baseId,
        excelUrl: parsed.data.excelUrl,
        tableName,
        importData,
        useFirstRowAsHeader,
        batchSize,
        maxRowCount,
        columns,
        sheetName,
        fileType,
      });
    }

    if ('excelData' in parsed.data && parsed.data.excelData) {
      return ImportExcelCommand.createFromBuffer({
        baseId,
        excelData: parsed.data.excelData,
        tableName,
        importData,
        useFirstRowAsHeader,
        batchSize,
        maxRowCount,
        columns,
        sheetName,
        fileType,
      });
    }

    return err(
      domainError.validation({
        message: 'Either excelData or excelUrl must be provided',
        code: 'import.excel.no_source',
      })
    );
  }

  static createFromBuffer(input: {
    baseId: string;
    excelData: Uint8Array;
    tableName?: string;
    importData?: boolean;
    useFirstRowAsHeader?: boolean;
    batchSize?: number;
    maxRowCount?: number;
    columns?: ReadonlyArray<ImportExcelColumn>;
    sheetName?: string;
    fileType?: string;
  }): Result<ImportExcelCommand, DomainError> {
    return ImportExcelCommand.fromParts({
      ...input,
      source: {
        type: normalizeExcelSourceType(input.fileType),
        data: input.excelData,
      },
    });
  }

  static createFromUrl(input: {
    baseId: string;
    excelUrl: string;
    tableName?: string;
    importData?: boolean;
    useFirstRowAsHeader?: boolean;
    batchSize?: number;
    maxRowCount?: number;
    columns?: ReadonlyArray<ImportExcelColumn>;
    sheetName?: string;
    fileType?: string;
  }): Result<ImportExcelCommand, DomainError> {
    try {
      new URL(input.excelUrl);
    } catch {
      return err(
        domainError.validation({
          message: 'Invalid Excel URL format',
          code: 'import.excel.invalid_url',
        })
      );
    }

    return ImportExcelCommand.fromParts({
      ...input,
      source: {
        type: normalizeExcelSourceType(input.fileType),
        url: input.excelUrl,
      },
    });
  }

  private static fromParts(input: {
    baseId: string;
    source: IImportSource;
    tableName?: string;
    importData?: boolean;
    useFirstRowAsHeader?: boolean;
    batchSize?: number;
    maxRowCount?: number;
    columns?: ReadonlyArray<ImportExcelColumn>;
    sheetName?: string;
  }): Result<ImportExcelCommand, DomainError> {
    const baseIdResult = BaseId.create(input.baseId);
    if (baseIdResult.isErr()) {
      return err(baseIdResult.error);
    }

    let tableNameVo: TableName | undefined;
    if (input.tableName) {
      const tableNameResult = TableName.create(input.tableName);
      if (tableNameResult.isErr()) {
        return err(tableNameResult.error);
      }
      tableNameVo = tableNameResult.value;
    }

    const batchSize = input.batchSize ?? 500;
    if (batchSize < 1 || batchSize > 5000) {
      return err(
        domainError.validation({
          message: 'batchSize must be between 1 and 5000',
        })
      );
    }

    return ok(
      new ImportExcelCommand(
        baseIdResult.value,
        input.source,
        tableNameVo,
        input.importData ?? true,
        batchSize,
        input.maxRowCount,
        input.useFirstRowAsHeader ?? true,
        input.columns,
        input.sheetName
      )
    );
  }
}

const normalizeExcelSourceType = (fileType: string | undefined): string => {
  const normalized = fileType?.toLowerCase();
  if (normalized === 'xlsx' || normalized === 'xls' || normalized === 'excel') {
    return normalized;
  }
  return 'excel';
};
