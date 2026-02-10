import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { ImportSourceType } from './IImportSource';
import type { IImportSourceAdapter } from './IImportSourceAdapter';

/**
 * Registry for import source adapters.
 *
 * Manages registration and lookup of adapters by source type.
 */
export interface IImportSourceRegistry {
  /**
   * Register an adapter for its supported types.
   */
  register(adapter: IImportSourceAdapter): void;

  /**
   * Get adapter for the given source type.
   *
   * @param type - Source type (e.g., 'csv', 'xlsx')
   * @returns Adapter or error if not found
   */
  getAdapter(type: ImportSourceType): Result<IImportSourceAdapter, DomainError>;

  /**
   * Get all registered source types.
   */
  getSupportedTypes(): ReadonlyArray<ImportSourceType>;

  /**
   * Check if a source type is supported.
   */
  supports(type: ImportSourceType): boolean;
}
