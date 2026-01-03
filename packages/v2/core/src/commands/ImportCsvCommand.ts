import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableName } from '../domain/table/TableName';
import type { CsvSource } from '../ports/CsvParser';

/**
 * CSV 导入配置 Schema（用于 HTTP API）
 */
export const importCsvInputSchema = z.object({
  baseId: z.string(),
  csvData: z.string().min(1, 'CSV data is required'),
  tableName: z.string().optional(),
  batchSize: z.number().min(1).max(5000).default(500),
});

export type IImportCsvCommandInput = z.input<typeof importCsvInputSchema>;

/**
 * CSV 导入 Command
 *
 * 功能：
 * 1. 解析 CSV 头部，自动创建表（所有列为 SingleLineText）
 * 2. 流式导入数据
 */
export class ImportCsvCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly csvSource: CsvSource,
    readonly tableName: TableName | undefined,
    readonly batchSize: number
  ) {}

  /**
   * 从 HTTP API 输入创建
   */
  static create(raw: unknown): Result<ImportCsvCommand, DomainError> {
    const parsed = importCsvInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ImportCsvCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return ImportCsvCommand.createFromString({
      baseId: parsed.data.baseId,
      csvData: parsed.data.csvData,
      tableName: parsed.data.tableName,
      batchSize: parsed.data.batchSize,
    });
  }

  /**
   * 从 Uint8Array 创建（文件上传场景）
   */
  static createFromBuffer(input: {
    baseId: string;
    csvData: Uint8Array;
    tableName?: string;
    batchSize?: number;
  }): Result<ImportCsvCommand, DomainError> {
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
      new ImportCsvCommand(
        baseIdResult.value,
        { type: 'buffer', data: input.csvData },
        tableNameVo,
        batchSize
      )
    );
  }

  /**
   * 从字符串创建（测试场景）
   */
  static createFromString(input: {
    baseId: string;
    csvData: string;
    tableName?: string;
    batchSize?: number;
  }): Result<ImportCsvCommand, DomainError> {
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
      new ImportCsvCommand(
        baseIdResult.value,
        { type: 'string', data: input.csvData },
        tableNameVo,
        batchSize
      )
    );
  }

  /**
   * 从流创建（大文件流式上传场景）
   */
  static createFromStream(input: {
    baseId: string;
    csvStream: AsyncIterable<Uint8Array | string>;
    tableName?: string;
    batchSize?: number;
  }): Result<ImportCsvCommand, DomainError> {
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
      new ImportCsvCommand(
        baseIdResult.value,
        { type: 'stream', data: input.csvStream },
        tableNameVo,
        batchSize
      )
    );
  }
}
