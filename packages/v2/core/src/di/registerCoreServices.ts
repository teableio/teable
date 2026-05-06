import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle } from '@teable/v2-di';

import { AttachmentValueDecoratorService } from '../application/services/AttachmentValueDecoratorService';
import { AttachmentValueResolverService } from '../application/services/AttachmentValueResolverService';
import { DeleteByRangeApplicationService } from '../application/services/DeleteByRangeApplicationService';
import { DuplicateRecordsApplicationService } from '../application/services/DuplicateRecordsApplicationService';
import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { FieldCrossTableUpdateSideEffectService } from '../application/services/FieldCrossTableUpdateSideEffectService';
import { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import { FieldUndoRedoReplayService } from '../application/services/FieldUndoRedoReplayService';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { FieldUpdateSideEffectService } from '../application/services/FieldUpdateSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { LinkFieldUpdateSideEffectService } from '../application/services/LinkFieldUpdateSideEffectService';
import { LinkTitleResolverService } from '../application/services/LinkTitleResolverService';
import { PasteLinkAutoResolveService } from '../application/services/PasteLinkAutoResolveService';
import { RecordBatchCreationService } from '../application/services/RecordBatchCreationService';
import { RecordBulkUpdateService } from '../application/services/RecordBulkUpdateService';
import { NullRecordChangedValueDecoratorService } from '../application/services/RecordChangedValueDecoratorService';
import { RecordCreationService } from '../application/services/RecordCreationService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordReorderService } from '../application/services/RecordReorderService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import {
  SchemaOperationRunnerService,
  type ISchemaOperationHandler,
} from '../application/services/SchemaOperationRunnerService';
import { TableCreationService } from '../application/services/TableCreationService';
import { TableDeletionSideEffectService } from '../application/services/TableDeletionSideEffectService';
import { TableFieldLimitFieldOperationPlugin } from '../application/services/TableFieldLimitFieldOperationPlugin';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableSchemaOperationRepairHandler } from '../application/services/TableSchemaOperationRepairHandler';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { UserValueResolverService } from '../application/services/UserValueResolverService';
import { PasteStreamApplicationService } from '../commands/PasteHandler';
import { NoopAttachmentUrlSignerService } from '../ports/defaults/NoopAttachmentUrlSignerService';
import { NoopRecordOrderCalculator } from '../ports/defaults/NoopRecordOrderCalculator';
import { NoopUndoRedoStore } from '../ports/defaults/NoopUndoRedoStore';
import type { IFieldOperationPlugin } from '../ports/FieldOperationPlugin';
import type { IRecordWritePlugin } from '../ports/RecordWritePlugin';
import { v2CoreTokens } from '../ports/tokens';
import { registerFieldOperationPlugin } from './registerFieldOperationPlugin';

/**
 * Register all v2 core internal application services.
 *
 * ## Purpose
 *
 * This function centralizes the registration of all core application services,
 * eliminating duplication across container packages (browser, node, etc.).
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
 * | fieldUpdateSideEffectService     | FieldUpdateSideEffectService   | Cascading field updates for dependent fields |
 * | tableDeletionSideEffectService   | TableDeletionSideEffectService | Cross-table cleanup before table deletion    |
 * | foreignTableLoaderService        | ForeignTableLoaderService      | Load and validate foreign table references   |
 * | linkTitleResolverService         | LinkTitleResolverService       | Resolve link titles to record IDs            |
 * | attachmentValueResolverService   | AttachmentValueResolverService | Resolve attachment values on writes          |
 * | userValueResolverService         | UserValueResolverService       | Resolve user values on writes                |
 * | recordMutationSpecResolverService| RecordMutationSpecResolverService | Resolve external values in specs         |
 * | recordWritePluginRunner          | RecordWritePluginRunner        | Run typed record-write plugins               |
 * | recordWriteSideEffectService     | RecordWriteSideEffectService   | Collect table side effects on record writes  |
 * | recordCreationService            | RecordCreationService          | Shared single-record creation workflow        |
 * | schemaOperationRunnerService     | SchemaOperationRunnerService   | Run repair handlers for schema operations     |
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

  // FieldUpdateSideEffectService - cascading field updates for dependent fields
  if (!container.isRegistered(v2CoreTokens.fieldUpdateSideEffectService)) {
    container.register(v2CoreTokens.fieldUpdateSideEffectService, FieldUpdateSideEffectService, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.tableDeletionSideEffectService)) {
    container.register(
      v2CoreTokens.tableDeletionSideEffectService,
      TableDeletionSideEffectService,
      {
        lifecycle,
      }
    );
  }

  if (!container.isRegistered(v2CoreTokens.fieldUndoRedoSnapshotService)) {
    container.register(v2CoreTokens.fieldUndoRedoSnapshotService, FieldUndoRedoSnapshotService, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.fieldUndoRedoReplayService)) {
    container.register(v2CoreTokens.fieldUndoRedoReplayService, FieldUndoRedoReplayService, {
      lifecycle,
    });
  }

  // FieldCrossTableUpdateSideEffectService - cross-table update side effects for field updates
  if (!container.isRegistered(v2CoreTokens.fieldCrossTableUpdateSideEffectService)) {
    container.register(
      v2CoreTokens.fieldCrossTableUpdateSideEffectService,
      FieldCrossTableUpdateSideEffectService,
      {
        lifecycle,
      }
    );
  }

  // LinkFieldUpdateSideEffectService - symmetric field creation/deletion for link fields
  if (!container.isRegistered(v2CoreTokens.linkFieldUpdateSideEffectService)) {
    container.register(
      v2CoreTokens.linkFieldUpdateSideEffectService,
      LinkFieldUpdateSideEffectService,
      { lifecycle }
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

  if (!container.isRegistered(v2CoreTokens.pasteLinkAutoResolveService)) {
    container.register(v2CoreTokens.pasteLinkAutoResolveService, PasteLinkAutoResolveService, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.pasteStreamApplicationService)) {
    container.register(v2CoreTokens.pasteStreamApplicationService, PasteStreamApplicationService, {
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

  // AttachmentUrlSignerService - default no-op; override in nest adapter
  if (!container.isRegistered(v2CoreTokens.attachmentUrlSignerService)) {
    container.register(v2CoreTokens.attachmentUrlSignerService, NoopAttachmentUrlSignerService, {
      lifecycle,
    });
  }

  // AttachmentValueDecoratorService - orchestrates attachment URL decoration
  if (!container.isRegistered(v2CoreTokens.attachmentValueDecoratorService)) {
    container.register(
      v2CoreTokens.attachmentValueDecoratorService,
      AttachmentValueDecoratorService,
      { lifecycle }
    );
  }

  if (!container.isRegistered(v2CoreTokens.recordChangedValueDecoratorService)) {
    container.register(
      v2CoreTokens.recordChangedValueDecoratorService,
      NullRecordChangedValueDecoratorService,
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

  if (!container.isRegistered(v2CoreTokens.recordWritePlugins)) {
    container.registerInstance(v2CoreTokens.recordWritePlugins, [] as IRecordWritePlugin[]);
  }

  if (!container.isRegistered(v2CoreTokens.recordWritePluginRunner)) {
    container.register(v2CoreTokens.recordWritePluginRunner, RecordWritePluginRunner, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.fieldOperationPlugins)) {
    container.registerInstance(v2CoreTokens.fieldOperationPlugins, [] as IFieldOperationPlugin[]);
  }

  registerFieldOperationPlugin(container, new TableFieldLimitFieldOperationPlugin(), {
    source: 'registerV2CoreServices',
  });

  if (!container.isRegistered(v2CoreTokens.fieldOperationPluginRunner)) {
    container.register(v2CoreTokens.fieldOperationPluginRunner, FieldOperationPluginRunner, {
      lifecycle,
    });
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

  if (!container.isRegistered(v2CoreTokens.recordBulkUpdateService)) {
    container.register(v2CoreTokens.recordBulkUpdateService, RecordBulkUpdateService, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.recordReorderService)) {
    container.register(v2CoreTokens.recordReorderService, RecordReorderService, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.recordWriteUndoRedoPlanService)) {
    container.register(
      v2CoreTokens.recordWriteUndoRedoPlanService,
      RecordWriteUndoRedoPlanService,
      {
        lifecycle,
      }
    );
  }

  if (!container.isRegistered(v2CoreTokens.recordBatchCreationService)) {
    container.register(v2CoreTokens.recordBatchCreationService, RecordBatchCreationService, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.schemaOperationHandlers)) {
    const defaultSchemaOperationHandlers: ISchemaOperationHandler[] = [];
    if (
      container.isRegistered(v2CoreTokens.schemaOperationRepository) &&
      container.isRegistered(v2CoreTokens.tableRepository) &&
      container.isRegistered(v2CoreTokens.tableSchemaRepository) &&
      container.isRegistered(v2CoreTokens.unitOfWork)
    ) {
      defaultSchemaOperationHandlers.push(container.resolve(TableSchemaOperationRepairHandler));
    }
    container.registerInstance(
      v2CoreTokens.schemaOperationHandlers,
      defaultSchemaOperationHandlers
    );
  }

  if (!container.isRegistered(v2CoreTokens.schemaOperationRunnerService)) {
    container.register(v2CoreTokens.schemaOperationRunnerService, SchemaOperationRunnerService, {
      lifecycle,
    });
  }

  // RecordCreationService - shared single-record creation workflow
  if (!container.isRegistered(v2CoreTokens.recordCreationService)) {
    container.register(v2CoreTokens.recordCreationService, RecordCreationService, {
      lifecycle,
    });
  }

  if (!container.isRegistered(v2CoreTokens.deleteByRangeApplicationService)) {
    container.register(
      v2CoreTokens.deleteByRangeApplicationService,
      DeleteByRangeApplicationService,
      {
        lifecycle,
      }
    );
  }

  if (!container.isRegistered(v2CoreTokens.duplicateRecordsApplicationService)) {
    container.register(
      v2CoreTokens.duplicateRecordsApplicationService,
      DuplicateRecordsApplicationService,
      {
        lifecycle,
      }
    );
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

  // UndoRedoStackService - per-window undo/redo stack append/replay
  if (!container.isRegistered(v2CoreTokens.undoRedoService)) {
    container.register(v2CoreTokens.undoRedoService, UndoRedoStackService, { lifecycle });
  }

  return container;
};
