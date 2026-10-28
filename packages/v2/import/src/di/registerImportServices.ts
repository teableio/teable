import { PapaparseCsvParser } from '@teable/v2-adapter-csv-parser-papaparse';
import { v2CoreTokens, type ICsvParser } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { ISsrfSafeFetchFn } from '@teable/v2-utils';

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
export interface IRegisterV2ImportServicesOptions {
  fetch?: ISsrfSafeFetchFn;
}

export const registerV2ImportServices = (
  container: DependencyContainer,
  options: IRegisterV2ImportServicesOptions = {}
): DependencyContainer => {
  // ImportSourceRegistry - registry of import source adapters
  // Register to core token so ImportRecordsHandler can use it
  if (!container.isRegistered(v2CoreTokens.importSourceRegistry)) {
    const registry = new ImportSourceRegistry();

    // Register default adapters
    registry.register(new CsvImportAdapter(options.fetch));
    registry.register(new ExcelImportAdapter(options.fetch));

    container.registerInstance(v2CoreTokens.importSourceRegistry, registry);
  }

  // CSV parsing is an import concern; a host-injected fetch keeps URL imports
  // SSRF-safe without mutating process globals.
  if (options.fetch || !container.isRegistered(v2CoreTokens.csvParser)) {
    const parser = new PapaparseCsvParser();
    if (options.fetch) parser.withFetch(options.fetch);
    container.registerInstance<ICsvParser>(v2CoreTokens.csvParser, parser);
  }

  return container;
};
