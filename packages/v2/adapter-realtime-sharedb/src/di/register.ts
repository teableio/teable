import {
  FieldCreatedRealtimeProjection,
  FieldDeletedRealtimeProjection,
  FieldOptionsAddedRealtimeProjection,
  TableCreatedRealtimeProjection,
  ViewColumnMetaUpdatedRealtimeProjection,
  RecordCreatedRealtimeProjection,
  RecordUpdatedRealtimeProjection,
  RecordsBatchUpdatedRealtimeProjection,
  RecordsBatchCreatedRealtimeProjection,
  RecordsDeletedRealtimeProjection,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

import type { IShareDbOpPublisher } from '../ShareDbPublisher';
import { ShareDbRealtimeEngine } from '../ShareDbRealtimeEngine';
import { v2ShareDbTokens } from './tokens';

export interface IV2ShareDbRealtimeConfig {
  publisher: IShareDbOpPublisher;
}

export const registerV2ShareDbRealtime = (
  c: DependencyContainer = container,
  config: IV2ShareDbRealtimeConfig
): DependencyContainer => {
  if (!config.publisher) {
    throw new Error('Invalid v2 ShareDB realtime config');
  }

  c.registerInstance(v2ShareDbTokens.publisher, config.publisher);
  c.register(v2CoreTokens.realtimeEngine, ShareDbRealtimeEngine, {
    lifecycle: Lifecycle.Singleton,
  });
  const hasTableDeps =
    c.isRegistered(v2CoreTokens.tableRepository) && c.isRegistered(v2CoreTokens.tableMapper);
  if (!hasTableDeps) {
    throw new Error('ShareDB realtime requires tableRepository and tableMapper registrations');
  }
  c.register(TableCreatedRealtimeProjection, TableCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(FieldCreatedRealtimeProjection, FieldCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(FieldDeletedRealtimeProjection, FieldDeletedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(ViewColumnMetaUpdatedRealtimeProjection, ViewColumnMetaUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(FieldOptionsAddedRealtimeProjection, FieldOptionsAddedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });

  // Record realtime projections
  c.register(RecordCreatedRealtimeProjection, RecordCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(RecordUpdatedRealtimeProjection, RecordUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(RecordsBatchUpdatedRealtimeProjection, RecordsBatchUpdatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(RecordsBatchCreatedRealtimeProjection, RecordsBatchCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(RecordsDeletedRealtimeProjection, RecordsDeletedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
