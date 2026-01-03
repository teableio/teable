import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableName } from '../domain/table/TableName';
import type { CsvSource } from '../ports/CsvParser';

/**
 * Base schema for CSV import (common fields)
 */
const importCsvBaseSchema = z.object({
  baseId: z.string(),
  tableName: z.string().optional(),
  batchSize: z.number().min(1).max(5000).default(500),
});

/**
 * CSV 导入配置 Schema（用于 HTTP API）
 * 支持两种导入方式：
 * 1. csvData: 直接传递 CSV 字符串
 * 2. csvUrl: 传递 CSV 文件的 URL（流式下载）
 */
export const importCsvInputSchema = z.union([
  importCsvBaseSchema.extend({
    csvData: z.string().min(1, 'CSV data is required'),
    csvUrl: z.undefined().optional(),
  }),
  importCsvBaseSchema.extend({
    csvUrl: z.string().url('Invalid CSV URL'),
    csvData: z.undefined().optional(),
  }),
]);

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
   * 自动根据输入类型选择 csvData 或 csvUrl 方式
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

    const { baseId, tableName, batchSize } = parsed.data;

    // 根据输入类型选择创建方式
    if ('csvUrl' in parsed.data && parsed.data.csvUrl) {
      return ImportCsvCommand.createFromUrl({
        baseId,
        csvUrl: parsed.data.csvUrl,
        tableName,
        batchSize,
      });
    }

    if ('csvData' in parsed.data && parsed.data.csvData) {
      return ImportCsvCommand.createFromString({
        baseId,
        csvData: parsed.data.csvData,
        tableName,
        batchSize,
      });
    }

    return err(
      domainError.validation({
        message: 'Either csvData or csvUrl must be provided',
        code: 'csv.no_source',
      })
    );
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

  /**
   * 从 URL 创建（远程 CSV 文件）
   * 支持流式下载和解析，适合大文件
   */
  static createFromUrl(input: {
    baseId: string;
    csvUrl: string;
    tableName?: string;
    batchSize?: number;
  }): Result<ImportCsvCommand, DomainError> {
    const baseIdResult = BaseId.create(input.baseId);
    if (baseIdResult.isErr()) {
      return err(baseIdResult.error);
    }

    // 简单 URL 格式验证
    try {
      new URL(input.csvUrl);
    } catch {
      return err(
        domainError.validation({
          message: 'Invalid CSV URL format',
          code: 'csv.invalid_url',
        })
      );
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
        { type: 'url', url: input.csvUrl },
        tableNameVo,
        batchSize
      )
    );
  }
}
