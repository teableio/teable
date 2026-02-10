import type { DependencyContainer } from '@teable/v2-di';
import { v2CoreTokens } from '@teable/v2-core';

import { CsvImportAdapter } from '../adapters/CsvImportAdapter';
import { ExcelImportAdapter } from '../adapters/ExcelImportAdapter';
import { ImportSourceRegistry } from '../ports/ImportSourceRegistry';

/**
 * Register v2 import adapters.
 *
 * ## Purpose
 *
 * This function registers the ImportSourceRegistry with default adapters (CSV, Excel).
 * The registry is used by ImportRecordsHandler in core to parse import sources.
 *
 * ## Behavior
 *
 * - Registers services only if they are NOT already registered
 * - This allows external containers to override default implementations by registering
 *   their own implementations BEFORE calling this function
 *
 * ## Services Registered
 *
 * | Token                  | Service                | Purpose                              |
 * |------------------------|------------------------|--------------------------------------|
 * | importSourceRegistry   | ImportSourceRegistry   | Registry of import source adapters   |
 *
 * ## Adapters Registered
 *
 * The following adapters are registered by default:
 * - CsvImportAdapter (csv, tsv, txt)
 * - ExcelImportAdapter (xlsx, xls, excel)
 *
 * ## Usage
 *
 * ```typescript
 * import { registerV2ImportServices } from '@teable/v2-import';
 *
 * // Register core services first (these are dependencies)
 * registerV2CoreServices(container);
 *
 * // Then register import services (adapters)
 * registerV2ImportServices(container);
 * ```
 *
 * @param container - The DI container to register services into
 */
export const registerV2ImportServices = (container: DependencyContainer): DependencyContainer => {
  // ImportSourceRegistry - registry of import source adapters
  // Register to core token so ImportRecordsHandler can use it
  if (!container.isRegistered(v2CoreTokens.importSourceRegistry)) {
    const registry = new ImportSourceRegistry();

    // Register default adapters
    registry.register(new CsvImportAdapter());
    registry.register(new ExcelImportAdapter());

    container.registerInstance(v2CoreTokens.importSourceRegistry, registry);
  }

  return container;
};
