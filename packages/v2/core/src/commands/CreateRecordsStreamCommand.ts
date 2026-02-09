import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import { TableId } from '../domain/table/TableId';
import type { RecordFieldValues } from './CreateRecordCommand';

export const createRecordsStreamInputSchema = z.object({
  tableId: z.string(),
  records: z
    .array(
      z.object({
        fields: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .min(1, 'At least one record is required'),
  batchSize: z.number().min(1).max(5000).default(500),
});

export type ICreateRecordsStreamCommandInput = z.input<typeof createRecordsStreamInputSchema>;
export type ICreateRecordsStreamCommandInputParsed = z.infer<typeof createRecordsStreamInputSchema>;

/**
 * 流式输入配置
 */
export interface ICreateRecordsStreamIterableInput {
  tableId: string;
  /** 可以是同步 Iterable 或异步 AsyncIterable */
  records: Iterable<{ fields: Record<string, unknown> }>;
  batchSize?: number;
}

export class CreateRecordsStreamCommand {
  private constructor(
    readonly tableId: TableId,
    /** 支持 Iterable，用于真正的流式处理 */
    readonly recordsFieldValues: Iterable<RecordFieldValues>,
    readonly batchSize: number
  ) {}

  /**
   * 从 JSON 输入创建（带 zod 验证，适用于 HTTP API）
   */
  static create(raw: unknown): Result<CreateRecordsStreamCommand, DomainError> {
    const parsed = createRecordsStreamInputSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid CreateRecordsStreamCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return TableId.create(parsed.data.tableId).map((tableId) => {
      const recordsFieldValues = parsed.data.records.map(
        (record) => new Map(Object.entries(record.fields)) as RecordFieldValues
      );
      return new CreateRecordsStreamCommand(tableId, recordsFieldValues, parsed.data.batchSize);
    });
  }

  /**
   * 从 Iterable 创建（无前置验证，适用于流式输入如 CSV 解析）
   * 验证会在域层按批次进行
   */
  static createFromIterable(
    input: ICreateRecordsStreamIterableInput
  ): Result<CreateRecordsStreamCommand, DomainError> {
    const tableIdResult = TableId.create(input.tableId);
    if (tableIdResult.isErr()) {
      return err(tableIdResult.error);
    }

    const batchSize = input.batchSize ?? 500;
    if (batchSize < 1 || batchSize > 5000) {
      return err(
        domainError.validation({
          message: 'batchSize must be between 1 and 5000',
        })
      );
    }

    // 包装 Iterable，将 { fields } 转换为 Map
    const recordsIterable: Iterable<RecordFieldValues> = {
      [Symbol.iterator]: function* () {
        for (const record of input.records) {
          yield new Map(Object.entries(record.fields)) as RecordFieldValues;
        }
      },
    };

    return ok(new CreateRecordsStreamCommand(tableIdResult.value, recordsIterable, batchSize));
  }
}
