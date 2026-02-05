import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle } from '@teable/v2-di';

import { v2CommandExplainTokens } from './tokens';
import { ExplainService } from '../service/ExplainService';
import { SqlExplainRunner } from '../utils/SqlExplainRunner';
import { ComplexityCalculator } from '../utils/ComplexityCalculator';
import { UpdateRecordAnalyzer } from '../analyzers/UpdateRecordAnalyzer';
import { CreateRecordAnalyzer } from '../analyzers/CreateRecordAnalyzer';
import { DeleteRecordsAnalyzer } from '../analyzers/DeleteRecordsAnalyzer';
import { PasteCommandAnalyzer } from '../analyzers/PasteCommandAnalyzer';

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
};
