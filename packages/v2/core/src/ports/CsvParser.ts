import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';

/**
 * CSV 数据源类型
 * 使用 Uint8Array 替代 Buffer 以保持平台无关性
 */
export type CsvSource =
  | { type: 'buffer'; data: Uint8Array }
  | { type: 'string'; data: string }
  | { type: 'stream'; data: AsyncIterable<Uint8Array | string> }
  | { type: 'url'; url: string };

/**
 * CSV 解析结果 - 包含头部和数据迭代器
 */
export interface CsvParseResult {
  /** CSV 列名（第一行） */
  readonly headers: ReadonlyArray<string>;

  /**
   * 数据行迭代器（不包含头部行）
   * 每行是 { [列名]: 值 } 的对象
   * 对于流式解析，这个迭代器是懒加载的
   */
  readonly rows: Iterable<Record<string, string>>;

  /**
   * 异步数据行迭代器（用于流式处理大文件和 URL）
   * 当使用 stream 或 url 类型源时，使用此迭代器
   */
  readonly rowsAsync?: AsyncIterable<Record<string, string>>;
}

/**
 * 支持的编码类型
 */
export type CsvEncoding = 'utf-8' | 'utf-16' | 'utf-16le' | 'utf-16be' | 'ascii' | 'latin1';

/**
 * CSV 解析选项
 */
export interface CsvParseOptions {
  /** 分隔符，默认逗号 */
  delimiter?: string;
  /** 是否有头部行，默认 true */
  hasHeader?: boolean;
  /** 编码，默认 utf-8 */
  encoding?: CsvEncoding;
  /** 跳过空行，默认 true */
  skipEmptyLines?: boolean;
}

/**
 * CSV 解析器端口
 *
 * 实现可以是：
 * - 内存解析（小文件）
 * - 流式解析（大文件，使用 csv-parse 等库）
 */
export interface ICsvParser {
  /**
   * 同步解析 CSV 数据（仅支持 string 和 buffer 类型）
   *
   * @param source CSV 数据源
   * @param options 解析选项
   * @returns 解析结果，包含 headers 和 rows 迭代器
   */
  parse(source: CsvSource, options?: CsvParseOptions): Result<CsvParseResult, DomainError>;

  /**
   * 异步解析 CSV 数据（支持 stream 和 url 类型）
   *
   * 流式解析特点：
   * - 返回 rowsAsync 而不是 rows
   * - 内存占用低，适合大文件
   * - headers 在解析第一行后立即可用
   *
   * @param source CSV 数据源
   * @param options 解析选项
   * @returns Promise 包含解析结果，使用 rowsAsync 迭代器
   */
  parseAsync?(
    source: CsvSource,
    options?: CsvParseOptions
  ): Promise<Result<CsvParseResult, DomainError>>;
}
