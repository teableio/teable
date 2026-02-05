import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type {
  IImportSource,
  IImportOptions,
  IImportParseResult,
  ImportSourceType,
} from './IImportSource';

/**
 * Adapter for parsing a specific import source type (e.g., CSV, Excel).
 *
 * Implementations should:
 * - Support both sync (data) and async (URL/stream) sources
 * - Return streaming row iterators for large files
 * - Handle encoding detection
 */
export interface IImportSourceAdapter {
  /**
   * Source types this adapter can handle (e.g., ['csv', 'tsv', 'txt'])
   */
  readonly supportedTypes: ReadonlyArray<ImportSourceType>;

  /**
   * Check if this adapter supports the given type.
   */
  supports(type: ImportSourceType): boolean;

  /**
   * Parse the import source and return headers and row iterator.
   *
   * For URL sources, should stream data to minimize memory usage.
   * For in-memory data, may return sync iterator.
   *
   * @param source - The import source
   * @param options - Parse options
   * @returns Parse result with headers and row iterator
   */
  parse(
    source: IImportSource,
    options?: IImportOptions
  ): Promise<Result<IImportParseResult, DomainError>>;
}
