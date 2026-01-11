import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle } from '@teable/v2-di';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { LinkTitleResolverService } from '../application/services/LinkTitleResolverService';
import { TableCreationService } from '../application/services/TableCreationService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { v2CoreTokens } from '../ports/tokens';

/**
 * Register all v2 core internal application services.
 *
 * ## Purpose
 *
 * This function centralizes the registration of all core application services,
 * eliminating duplication across container packages (browser, node, bun, etc.).
 *
 * ## Behavior
 *
 * - Registers services only if they are NOT already registered
 * - This allows external containers to override default implementations by registering
 *   their own implementations BEFORE calling this function
 *
 * ## Services Registered
 *
 * | Token                            | Service                        | Purpose                                      |
 * |----------------------------------|--------------------------------|----------------------------------------------|
 * | tableUpdateFlow                  | TableUpdateFlow                | Transactional table update workflow          |
 * | tableQueryService                | TableQueryService              | Common table lookup operations               |
 * | fieldCreationSideEffectService   | FieldCreationSideEffectService | Cross-table field creation side effects      |
 * | fieldDeletionSideEffectService   | FieldDeletionSideEffectService | Cross-table field deletion side effects      |
 * | foreignTableLoaderService        | ForeignTableLoaderService      | Load and validate foreign table references   |
 * | linkTitleResolverService         | LinkTitleResolverService       | Resolve link titles to record IDs            |
 *
 * ## Usage
 *
 * ```typescript
 * // In container setup:
 * import { registerV2CoreServices } from '@teable/v2-core';
 *
 * // Register infrastructure dependencies first (repositories, buses, etc.)
 * c.register(v2CoreTokens.tableRepository, PostgresTableRepository);
 * c.register(v2CoreTokens.unitOfWork, PostgresUnitOfWork);
 * // ...
 *
 * // Then register core services (uses defaults unless already registered)
 * registerV2CoreServices(c, { lifecycle: Lifecycle.Singleton });
 * ```
 *
 * ## Overriding
 *
 * To override a service, register your implementation BEFORE calling this function:
 *
 * ```typescript
 * // Override TableQueryService with custom implementation
 * c.register(v2CoreTokens.tableQueryService, CustomTableQueryService);
 *
 * // This will NOT override - TableQueryService is already registered
 * registerV2CoreServices(c);
 * ```
 *
 * @param container - The DI container to register services into
 * @param options - Registration options (lifecycle, etc.)
 */
export interface IRegisterCoreServicesOptions {
  /**
   * Lifecycle for registered services.
   * @default 'Singleton'
   */
  lifecycle?: Lifecycle;
}

export const registerV2CoreServices = (
  container: DependencyContainer,
  options: IRegisterCoreServicesOptions = {}
): DependencyContainer => {
  // Default to Singleton lifecycle
  const lifecycle = options.lifecycle ?? Lifecycle.Singleton;

  // TableUpdateFlow - transactional table update workflow
  if (!container.isRegistered(v2CoreTokens.tableUpdateFlow)) {
    container.register(v2CoreTokens.tableUpdateFlow, TableUpdateFlow, { lifecycle });
  }

  // TableQueryService - common table lookup operations
  if (!container.isRegistered(v2CoreTokens.tableQueryService)) {
    container.register(v2CoreTokens.tableQueryService, TableQueryService, { lifecycle });
  }

  // FieldCreationSideEffectService - cross-table field creation side effects
  if (!container.isRegistered(v2CoreTokens.fieldCreationSideEffectService)) {
    container.register(
      v2CoreTokens.fieldCreationSideEffectService,
      FieldCreationSideEffectService,
      {
        lifecycle,
      }
    );
  }

  // FieldDeletionSideEffectService - cross-table field deletion side effects
  if (!container.isRegistered(v2CoreTokens.fieldDeletionSideEffectService)) {
    container.register(
      v2CoreTokens.fieldDeletionSideEffectService,
      FieldDeletionSideEffectService,
      {
        lifecycle,
      }
    );
  }

  // TableCreationService - batch table creation with side effects
  if (!container.isRegistered(v2CoreTokens.tableCreationService)) {
    container.register(v2CoreTokens.tableCreationService, TableCreationService, {
      lifecycle,
    });
  }

  // ForeignTableLoaderService - load and validate foreign table references
  if (!container.isRegistered(v2CoreTokens.foreignTableLoaderService)) {
    container.register(v2CoreTokens.foreignTableLoaderService, ForeignTableLoaderService, {
      lifecycle,
    });
  }

  // LinkTitleResolverService - resolve link titles to record IDs (typecast support)
  if (!container.isRegistered(v2CoreTokens.linkTitleResolverService)) {
    container.register(v2CoreTokens.linkTitleResolverService, LinkTitleResolverService, {
      lifecycle,
    });
  }

  return container;
};
