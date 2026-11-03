import {
  DeleteByRangeApplicationService,
  type BulkRecordPreparationService,
  type FieldConversionPreparationService,
  type FieldDeletionPreparationService,
  type IDuplicateTablePreparationService,
  type ITableDeletionPreparationService,
  type ITableRecordAggregationQueryRepository,
  type PastePreparationService,
  TableQueryService,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

import {
  BulkDeletePreviewPlanner,
  createBulkDeletePreviewRegistration,
} from './BulkDeletePreviewPlanner';
import {
  BulkUpdatePreviewPlanner,
  createBulkUpdatePreviewRegistration,
} from './BulkUpdatePreviewPlanner';
import {
  createFieldConvertPreviewRegistration,
  FieldConvertPreviewPlanner,
} from './FieldConvertPreviewPlanner';
import {
  createFieldDeletePreviewRegistration,
  FieldDeletePreviewPlanner,
} from './FieldDeletePreviewPlanner';
import { PreviewPlannerRegistry } from './PreviewPlannerRegistry';
import {
  createRecordsPastePreviewRegistration,
  RecordsPastePreviewPlanner,
} from './RecordsPastePreviewPlanner';
import {
  createTableDeletePreviewRegistration,
  TableDeletePreviewPlanner,
} from './TableDeletePreviewPlanner';
import { createTableDuplicatePreviewRegistration } from './TableDuplicatePreviewPlanner';
import type { PreviewOperationRegistration } from './types';

const register = <TInput>(
  registry: PreviewPlannerRegistry,
  registration: PreviewOperationRegistration<TInput>
): void => {
  const result = registry.register(registration);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

/** Builds the core-owned planner set. Host-owned operations are registered by host adapters. */
export const createCorePreviewPlannerRegistry = (
  container: DependencyContainer
): PreviewPlannerRegistry => {
  const tableQueryService = container.resolve<TableQueryService>(v2CoreTokens.tableQueryService);
  const recordQueryRepository = container.resolve<ITableRecordAggregationQueryRepository>(
    v2CoreTokens.tableRecordQueryRepository
  );
  const fieldConversionPreparation = container.resolve<FieldConversionPreparationService>(
    v2CoreTokens.fieldConversionPreparationService
  );
  const fieldDeletionPreparation = container.resolve<FieldDeletionPreparationService>(
    v2CoreTokens.fieldDeletionPreparationService
  );
  const tableDeletionPreparation = container.resolve<ITableDeletionPreparationService>(
    v2CoreTokens.tableDeletionPreparationService
  );
  const pastePreparation = container.resolve<PastePreparationService>(
    v2CoreTokens.pastePreparationService
  );
  const bulkPreparation = container.resolve<BulkRecordPreparationService>(
    v2CoreTokens.bulkRecordPreparationService
  );
  const duplicatePreparation = container.resolve<IDuplicateTablePreparationService>(
    v2CoreTokens.duplicateTablePreparationService
  );
  const rangeDeletion: Pick<DeleteByRangeApplicationService, 'prepareDelete'> = {
    prepareDelete: (context, command) =>
      container
        .resolve<DeleteByRangeApplicationService>(v2CoreTokens.deleteByRangeApplicationService)
        .prepareDelete(context, command),
  };

  const registry = PreviewPlannerRegistry.empty();
  register(
    registry,
    createFieldConvertPreviewRegistration(
      new FieldConvertPreviewPlanner(fieldConversionPreparation, recordQueryRepository)
    )
  );
  register(
    registry,
    createFieldDeletePreviewRegistration(new FieldDeletePreviewPlanner(fieldDeletionPreparation))
  );
  register(
    registry,
    createTableDeletePreviewRegistration(new TableDeletePreviewPlanner(tableDeletionPreparation))
  );
  register(registry, createTableDuplicatePreviewRegistration(duplicatePreparation));
  register(
    registry,
    createRecordsPastePreviewRegistration(new RecordsPastePreviewPlanner(pastePreparation))
  );
  register(
    registry,
    createBulkUpdatePreviewRegistration(
      new BulkUpdatePreviewPlanner(tableQueryService, bulkPreparation)
    )
  );
  register(
    registry,
    createBulkDeletePreviewRegistration(
      new BulkDeletePreviewPlanner(tableQueryService, rangeDeletion, bulkPreparation)
    )
  );
  return registry;
};
