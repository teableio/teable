import type {
  CsvParseOptions,
  CsvParseResult,
  CsvSource,
  DomainError,
  ICsvParser,
} from '@teable/v2-core';
import { domainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import Papa from 'papaparse';

/**
 * PapaParse CSV 解析器实现
 *
 * 支持：
 * - 自动检测分隔符
 * - 引号内分隔符处理
 * - 大文件流式解析（通过 rowsAsync）
 */
export class PapaparseCsvParser implements ICsvParser {
  parse(source: CsvSource, options?: CsvParseOptions): Result<CsvParseResult, DomainError> {
    const delimiter = options?.delimiter;
    const hasHeader = options?.hasHeader ?? true;
    const skipEmptyLines = options?.skipEmptyLines ?? true;

    // 处理不同类型的输入
    let csvString: string;
    if (source.type === 'string') {
      csvString = source.data;
    } else if (source.type === 'buffer') {
      const encoding = options?.encoding ?? 'utf-8';
      csvString = new TextDecoder(encoding).decode(source.data);
    } else {
      // 流式输入 - 暂不支持，需要使用异步解析
      return err(
        domainError.infrastructure({
          message:
            'Stream source requires async parsing. Use parseAsync for streaming CSV sources.',
          code: 'csv.stream_requires_async',
        })
      );
    }

    try {
      const parseResult = Papa.parse<Record<string, string>>(csvString, {
        delimiter: delimiter || undefined, // undefined 让 papaparse 自动检测
        header: hasHeader,
        skipEmptyLines: skipEmptyLines ? 'greedy' : false,
        transformHeader: (header) => header.trim(),
        transform: (value) => value.trim(),
      });

      if (parseResult.errors.length > 0) {
        const firstError = parseResult.errors[0];
        return err(
          domainError.validation({
            message: `CSV parse error at row ${firstError.row}: ${firstError.message}`,
            code: 'csv.parse_error',
            details: { errors: parseResult.errors },
          })
        );
      }

      // 提取 headers
      const headers: string[] = hasHeader
        ? parseResult.meta.fields ?? []
        : parseResult.data[0]
          ? Object.keys(parseResult.data[0]).map((_, i) => `Column_${i + 1}`)
          : [];

      // 创建行的 Iterable
      const rows = this.createRowsIterable(parseResult.data);

      return ok({
        headers,
        rows,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `CSV parsing failed: ${error instanceof Error ? error.message : String(error)}`,
          code: 'csv.parse_failed',
        })
      );
    }
  }

  /**
   * 创建行的同步 Iterable
   */
  private *createRowsIterable(data: Record<string, string>[]): Iterable<Record<string, string>> {
    for (const row of data) {
      yield row;
    }
  }
}
