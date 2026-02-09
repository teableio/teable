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
   * 异步流式解析 CSV
   *
   * 支持：
   * - URL 远程文件（流式下载）
   * - Stream 数据源
   * - 内存数据源（自动降级）
   */
  async parseAsync(
    source: CsvSource,
    options?: CsvParseOptions
  ): Promise<Result<CsvParseResult, DomainError>> {
    // 对于 string 和 buffer，使用同步解析
    if (source.type === 'string' || source.type === 'buffer') {
      return this.parse(source, options);
    }

    const delimiter = options?.delimiter;
    const hasHeader = options?.hasHeader ?? true;
    const skipEmptyLines = options?.skipEmptyLines ?? true;

    if (source.type === 'url') {
      return this.parseFromUrl(source.url, { delimiter, hasHeader, skipEmptyLines });
    }

    if (source.type === 'stream') {
      return this.parseFromStream(source.data, options);
    }

    return err(
      domainError.infrastructure({
        message: 'Unsupported CSV source type',
        code: 'csv.unsupported_source',
      })
    );
  }

  /**
   * 从 URL 流式解析 CSV
   *
   * 使用 fetch + ReadableStream 实现流式处理：
   * - 边下载边解析
   * - 返回 rowsAsync 异步迭代器
   * - 支持 Node.js 和浏览器环境
   */
  private async parseFromUrl(
    url: string,
    options: { delimiter?: string; hasHeader: boolean; skipEmptyLines: boolean }
  ): Promise<Result<CsvParseResult, DomainError>> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        return err(
          domainError.infrastructure({
            message: `Failed to fetch CSV from URL: ${response.status} ${response.statusText}`,
            code: 'csv.fetch_error',
          })
        );
      }

      if (!response.body) {
        return err(
          domainError.infrastructure({
            message: 'Response body is not available for streaming',
            code: 'csv.no_stream',
          })
        );
      }

      // 创建流式解析器
      const { headers, rowsAsync } = await this.createStreamingParser(response.body, options);

      return ok({
        headers,
        rows: [], // 空数组，使用 rowsAsync
        rowsAsync,
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `CSV download error: ${error instanceof Error ? error.message : String(error)}`,
          code: 'csv.download_error',
        })
      );
    }
  }

  /**
   * 创建流式 CSV 解析器
   * 返回 headers 和异步行迭代器
   */
  private async createStreamingParser(
    body: ReadableStream<Uint8Array>,
    options: { delimiter?: string; hasHeader: boolean; skipEmptyLines: boolean }
  ): Promise<{ headers: string[]; rowsAsync: AsyncIterable<Record<string, string>> }> {
    const decoder = new TextDecoder();
    const reader = body.getReader();

    // 收集数据直到可以确定 headers
    let buffer = '';
    let headers: string[] = [];
    let headersDetermined = false;
    const pendingRows: Record<string, string>[] = [];

    // 先读取足够的数据来确定 headers
    while (!headersDetermined) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 尝试解析 headers
      const lines = buffer.split(/\r?\n/);
      if (lines.length > 1 || done) {
        // 有完整的第一行了
        const parseResult = Papa.parse<Record<string, string>>(buffer, {
          delimiter: options.delimiter || undefined,
          header: options.hasHeader,
          skipEmptyLines: options.skipEmptyLines ? 'greedy' : false,
          transformHeader: (header) => header.trim(),
          transform: (value) => value.trim(),
        });

        if (parseResult.meta.fields) {
          headers = parseResult.meta.fields;
        } else if (parseResult.data.length > 0) {
          headers = Object.keys(parseResult.data[0]).map((_, i) => `Column_${i + 1}`);
        }

        // 保存已解析的行
        pendingRows.push(...parseResult.data);
        headersDetermined = true;

        // 保留未完成的最后一行
        if (!done && lines.length > 1) {
          buffer = lines[lines.length - 1];
        } else {
          buffer = '';
        }
      }
    }

    // 创建异步迭代器
    const rowsAsync: AsyncIterable<Record<string, string>> = {
      [Symbol.asyncIterator]: () => {
        let pendingIndex = 0;
        let readerDone = false;
        let currentBuffer = buffer;

        return {
          async next(): Promise<IteratorResult<Record<string, string>>> {
            // 先返回已解析的 pending rows
            if (pendingIndex < pendingRows.length) {
              return { value: pendingRows[pendingIndex++], done: false };
            }

            // 继续从流中读取
            while (!readerDone) {
              const { done, value } = await reader.read();
              if (done) {
                readerDone = true;
                // 处理剩余的 buffer
                if (currentBuffer.trim()) {
                  const parseResult = Papa.parse<Record<string, string>>(currentBuffer, {
                    delimiter: options.delimiter || undefined,
                    header: options.hasHeader,
                    skipEmptyLines: options.skipEmptyLines ? 'greedy' : false,
                    transformHeader: (header) => header.trim(),
                    transform: (value) => value.trim(),
                  });
                  if (parseResult.data.length > 0) {
                    pendingRows.push(...parseResult.data);
                    if (pendingIndex < pendingRows.length) {
                      return { value: pendingRows[pendingIndex++], done: false };
                    }
                  }
                }
                break;
              }

              currentBuffer += decoder.decode(value, { stream: true });

              // 按行解析
              const lines = currentBuffer.split(/\r?\n/);
              if (lines.length > 1) {
                // 解析除最后一行外的所有行
                const completeData = lines.slice(0, -1).join('\n');
                currentBuffer = lines[lines.length - 1];

                const parseResult = Papa.parse<Record<string, string>>(completeData, {
                  delimiter: options.delimiter || undefined,
                  header: options.hasHeader,
                  skipEmptyLines: options.skipEmptyLines ? 'greedy' : false,
                  transformHeader: (header) => header.trim(),
                  transform: (value) => value.trim(),
                });

                if (parseResult.data.length > 0) {
                  pendingRows.push(...parseResult.data);
                  if (pendingIndex < pendingRows.length) {
                    return { value: pendingRows[pendingIndex++], done: false };
                  }
                }
              }
            }

            return { value: undefined as never, done: true };
          },
        };
      },
    };

    return { headers, rowsAsync };
  }

  /**
   * 从 AsyncIterable stream 解析 CSV
   */
  private async parseFromStream(
    stream: AsyncIterable<Uint8Array | string>,
    options?: CsvParseOptions
  ): Promise<Result<CsvParseResult, DomainError>> {
    const encoding = options?.encoding ?? 'utf-8';
    const decoder = new TextDecoder(encoding);

    // 将 stream 收集为字符串
    // TODO: 实现真正的流式解析（需要 papaparse 的 Node.js stream 支持或使用其他库）
    let csvString = '';
    for await (const chunk of stream) {
      if (typeof chunk === 'string') {
        csvString += chunk;
      } else {
        csvString += decoder.decode(chunk, { stream: true });
      }
    }
    csvString += decoder.decode(); // flush remaining

    // 使用同步解析
    return this.parse({ type: 'string', data: csvString }, options);
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
