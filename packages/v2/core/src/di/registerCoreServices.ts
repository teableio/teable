import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle } from '@teable/v2-di';

import { AttachmentValueResolverService } from '../application/services/AttachmentValueResolverService';
import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { LinkTitleResolverService } from '../application/services/LinkTitleResolverService';
import { RecordCreateConstraintService } from '../application/services/RecordCreateConstraintService';
import { RecordCreationService } from '../application/services/RecordCreationService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableCreationService } from '../application/services/TableCreationService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UndoRedoService } from '../application/services/UndoRedoService';
import { UserValueResolverService } from '../application/services/UserValueResolverService';
import type { IRecordCreateConstraint } from '../ports/RecordCreateConstraintService';
import { NoopRecordOrderCalculator } from '../ports/defaults/NoopRecordOrderCalculator';
import { NoopUndoRedoStore } from '../ports/defaults/NoopUndoRedoStore';
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
 * | attachmentValueResolverService   | AttachmentValueResolverService | Resolve attachment values on writes          |
 * | userValueResolverService         | UserValueResolverService       | Resolve user values on writes                |
 * | recordMutationSpecResolverService| RecordMutationSpecResolverService | Resolve external values in specs         |
 * | recordWriteSideEffectService     | RecordWriteSideEffectService   | Collect table side effects on record writes  |
 * | recordCreationService            | RecordCreationService          | Shared single-record creation workflow        |
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

  // AttachmentValueResolverService - resolve attachment values
  if (!container.isRegistered(v2CoreTokens.attachmentValueResolverService)) {
    container.register(
      v2CoreTokens.attachmentValueResolverService,
      AttachmentValueResolverService,
      {
        lifecycle,
      }
    );
  }

  // UserValueResolverService - resolve user values
  if (!container.isRegistered(v2CoreTokens.userValueResolverService)) {
    container.register(v2CoreTokens.userValueResolverService, UserValueResolverService, {
      lifecycle,
    });
  }

  // RecordCreateConstraintService - default no-op constraint aggregator
  if (!container.isRegistered(v2CoreTokens.recordCreateConstraints)) {
    container.registerInstance(
      v2CoreTokens.recordCreateConstraints,
      [] as IRecordCreateConstraint[]
    );
  }
  if (!container.isRegistered(v2CoreTokens.recordCreateConstraintService)) {
    const constraints = container.resolve<IRecordCreateConstraint[]>(
      v2CoreTokens.recordCreateConstraints
    );
    container.registerInstance(
      v2CoreTokens.recordCreateConstraintService,
      new RecordCreateConstraintService(constraints)
    );
  }

  // RecordMutationSpecResolverService - resolve external values in specs
  if (!container.isRegistered(v2CoreTokens.recordMutationSpecResolverService)) {
    container.register(
      v2CoreTokens.recordMutationSpecResolverService,
      RecordMutationSpecResolverService,
      { lifecycle }
    );
  }

  // RecordWriteSideEffectService - table side effects on record writes
  if (!container.isRegistered(v2CoreTokens.recordWriteSideEffectService)) {
    container.register(v2CoreTokens.recordWriteSideEffectService, RecordWriteSideEffectService, {
      lifecycle,
    });
  }

  // RecordCreationService - shared single-record creation workflow
  if (!container.isRegistered(v2CoreTokens.recordCreationService)) {
    container.register(v2CoreTokens.recordCreationService, RecordCreationService, {
      lifecycle,
    });
  }

  // RecordOrderCalculator - default no-op (must be provided by adapter)
  if (!container.isRegistered(v2CoreTokens.recordOrderCalculator)) {
    container.register(v2CoreTokens.recordOrderCalculator, NoopRecordOrderCalculator, {
      lifecycle,
    });
  }

  // UndoRedoStore - default no-op store
  if (!container.isRegistered(v2CoreTokens.undoRedoStore)) {
    container.registerInstance(v2CoreTokens.undoRedoStore, new NoopUndoRedoStore());
  }

  // UndoRedoService - record undo/redo operations
  if (!container.isRegistered(v2CoreTokens.undoRedoService)) {
    container.register(v2CoreTokens.undoRedoService, UndoRedoService, { lifecycle });
  }

  return container;
};
