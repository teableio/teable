import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle } from '@teable/v2-di';

import { v2CommandExplainTokens } from './tokens';
import { ExplainService } from '../service/ExplainService';
import { ComplexityService } from '../service/ComplexityService';
import type { IComplexityService } from '../service/ComplexityService';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { CreateFieldAnalyzer } from '../analyzers/CreateFieldAnalyzer';
import { UpdateRecordAnalyzer } from '../analyzers/UpdateRecordAnalyzer';
import { CreateRecordAnalyzer } from '../analyzers/CreateRecordAnalyzer';
import { UpdateFieldAnalyzer } from '../analyzers/UpdateFieldAnalyzer';
import { DeleteFieldAnalyzer } from '../analyzers/DeleteFieldAnalyzer';
import { DeleteTableAnalyzer } from '../analyzers/DeleteTableAnalyzer';
import { DeleteRecordsAnalyzer } from '../analyzers/DeleteRecordsAnalyzer';
import { PasteCommandAnalyzer } from '../analyzers/PasteCommandAnalyzer';
import { createCorePreviewPlannerRegistry, OperationPreviewService } from '../preview';

/**
 * Register command-explain module services.
 */
export const registerCommandExplainModule = (container: DependencyContainer): void => {
  // Register utilities
  container.register(v2CommandExplainTokens.sqlExplainRunner, SqlExplainRunner, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.complexityCalculator, ComplexityCalculator, {
    lifecycle: Lifecycle.Singleton,
  });

  // Register analyzers
  container.register(v2CommandExplainTokens.createFieldAnalyzer, CreateFieldAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.updateFieldAnalyzer, UpdateFieldAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.deleteFieldAnalyzer, DeleteFieldAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.deleteTableAnalyzer, DeleteTableAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.updateRecordAnalyzer, UpdateRecordAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.createRecordAnalyzer, CreateRecordAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.deleteRecordsAnalyzer, DeleteRecordsAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.pasteCommandAnalyzer, PasteCommandAnalyzer, {
    lifecycle: Lifecycle.Singleton,
  });

  // Register main service
  container.register(v2CommandExplainTokens.explainService, ExplainService, {
    lifecycle: Lifecycle.Singleton,
  });
  container.register(v2CommandExplainTokens.complexityService, ComplexityService, {
    lifecycle: Lifecycle.Singleton,
  });

  const previewPlannerRegistry = createCorePreviewPlannerRegistry(container);
  container.registerInstance(v2CommandExplainTokens.previewPlannerRegistry, previewPlannerRegistry);
  container.registerInstance(
    v2CommandExplainTokens.operationPreviewService,
    new OperationPreviewService(previewPlannerRegistry, {
      complexityService: container.resolve<IComplexityService>(
        v2CommandExplainTokens.complexityService
      ),
    })
  );
};
