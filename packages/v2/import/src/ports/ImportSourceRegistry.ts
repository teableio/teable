import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  domainError,
  type DomainError,
  type IImportSourceAdapter,
  type IImportSourceRegistry,
  type ImportSourceType,
} from '@teable/v2-core';

/**
 * Default adapter registry implementation
 */
export class ImportSourceRegistry implements IImportSourceRegistry {
  private readonly adapters: IImportSourceAdapter[] = [];
  private readonly typeToAdapter = new Map<ImportSourceType, IImportSourceAdapter>();

  register(adapter: IImportSourceAdapter): void {
    this.adapters.push(adapter);
    for (const type of adapter.supportedTypes) {
      this.typeToAdapter.set(type, adapter);
    }
  }

  getAdapter(type: ImportSourceType): Result<IImportSourceAdapter, DomainError> {
    const adapter = this.typeToAdapter.get(type);
    if (!adapter) {
      return err(
        domainError.validation({
          message: `No adapter registered for import type: ${type}`,
          code: 'import.unsupported_type',
          details: { type, supportedTypes: this.getSupportedTypes() },
        })
      );
    }
    return ok(adapter);
  }

  getSupportedTypes(): ReadonlyArray<ImportSourceType> {
    return [...this.typeToAdapter.keys()];
  }

  supports(type: ImportSourceType): boolean {
    return this.typeToAdapter.has(type);
  }
}
