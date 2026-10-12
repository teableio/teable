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

import { parseCsvRows } from './parseCsvRows';

/**
 * PapaParse CSV 解析器实现
 *
 * 支持：
 * - 自动检测分隔符
 * - 引号内分隔符处理
 * - 大文件流式解析（通过 parseAsync + rowsAsync）
 * - 远程 URL 流式下载解析
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
      // 流式输入和 URL - 需要使用异步解析
      return err(
        domainError.infrastructure({
          message:
            'Stream/URL source requires async parsing. Use parseAsync for streaming CSV sources.',
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

      const rows = hasHeader
        ? parseResult.data
        : this.mapRowsToGeneratedHeaders(parseResult.data as unknown as string[][]);
      const headers: string[] = hasHeader
        ? parseResult.meta.fields ?? []
        : rows[0]
          ? Object.keys(rows[0])
          : [];

      // 创建行的 Iterable
      return ok({
        headers,
        rows: this.createRowsIterable(rows),
        rowCount: rows.length,
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
   * 异步流式解析 CSV
   *
   * 支持：
   * - URL 远程文件（流式下载）
   * - Stream 数据源
   * - 内存数据源（分块解析，不构建完整行数组）
   */
  async parseAsync(
    source: CsvSource,
    options?: CsvParseOptions
  ): Promise<Result<CsvParseResult, DomainError>> {
    const iterator = parseCsvRows(source, {
      delimiter: options?.delimiter,
      encoding: options?.encoding,
      skipEmptyLines: options?.skipEmptyLines ?? true ? 'greedy' : false,
    });
    try {
      const first = await iterator.next();
      const hasHeader = options?.hasHeader ?? true;
      const headers = first.done
        ? []
        : first.value.map((value, index) => (hasHeader ? value.trim() : `Column_${index + 1}`));
      if (hasHeader) this.deduplicateHeaders(headers);
      let pending = !hasHeader && !first.done ? first.value : undefined;
      // Inline sources previously used Papa's strict header-width validation.
      const validateFieldCount =
        hasHeader && (source.type === 'string' || source.type === 'buffer');
      const rowsAsync: AsyncIterableIterator<Record<string, string>> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          const row = pending;
          pending = undefined;
          const next = row ? { done: false, value: row } : await iterator.next();
          if (next.done) return { done: true, value: undefined };
          if (validateFieldCount && next.value.length !== headers.length) {
            await iterator.return(undefined);
            throw domainError.validation({
              message: `CSV row has ${next.value.length} fields but the header has ${headers.length}`,
              code: 'csv.parse_error',
            });
          }
          return {
            done: false,
            value: Object.fromEntries(
              headers.map((header, index) => [header, (next.value[index] ?? '').trim()])
            ),
          };
        },
        async return() {
          pending = undefined;
          await iterator.return(undefined);
          return { done: true, value: undefined };
        },
        async throw(error) {
          pending = undefined;
          await iterator.throw(error);
          return { done: true, value: undefined };
        },
      };
      return ok({ headers, rows: [], rowsAsync });
    } catch (error) {
      await iterator.return(undefined);
      return err(domainError.fromUnknown(error, { code: 'csv.parse_failed' }));
    }
  }

  private deduplicateHeaders(headers: string[]): void {
    const used = new Set(headers);
    const counts = new Map<string, number>();
    for (let index = 0; index < headers.length; index++) {
      const header = headers[index];
      let suffix = counts.get(header) ?? 0;
      if (suffix > 0) {
        while (used.has(`${header}_${suffix}`)) suffix++;
        headers[index] = `${header}_${suffix}`;
        used.add(headers[index]);
      }
      counts.set(header, suffix + 1);
    }
  }

  private mapRowsToGeneratedHeaders(rows: string[][]): Record<string, string>[] {
    const headers = rows[0]?.map((_, index) => `Column_${index + 1}`) ?? [];
    return this.mapRowsToHeaders(rows, headers);
  }

  private mapRowsToHeaders(
    rows: string[][],
    headers: ReadonlyArray<string>
  ): Record<string, string>[] {
    return rows.map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
    );
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
