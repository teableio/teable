import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { CsvParseOptions, CsvParseResult, CsvSource, ICsvParser } from '../CsvParser';

/**
 * Noop CSV 解析器 - 用于测试或未配置解析器时
 */
export class NoopCsvParser implements ICsvParser {
  parse(_source: CsvSource, _options?: CsvParseOptions): Result<CsvParseResult, DomainError> {
    return err(
      domainError.infrastructure({
        message: 'CSV parser not configured',
        code: 'csv.parser_not_configured',
      })
    );
  }
}
