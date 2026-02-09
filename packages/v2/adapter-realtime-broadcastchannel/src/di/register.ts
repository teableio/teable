import {
  FieldCreatedRealtimeProjection,
  FieldDeletedRealtimeProjection,
  TableCreatedRealtimeProjection,
  ViewColumnMetaUpdatedRealtimeProjection,
  RecordCreatedRealtimeProjection,
  RecordUpdatedRealtimeProjection,
  RecordsBatchUpdatedRealtimeProjection,
  RecordsDeletedRealtimeProjection,
  v2CoreTokens,
} from '@teable/v2-core';
import type { ILogger } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

import { BroadcastChannelRealtimeEngine } from '../BroadcastChannelRealtimeEngine';
import {
  broadcastChannelDefaults,
  getBroadcastChannelRealtimeHub,
} from '../BroadcastChannelRealtimeHub';
import { v2BroadcastChannelTokens } from './tokens';

export type IV2BroadcastChannelRealtimeConfig = {
  channelName?: string;
};

export const registerV2BroadcastChannelRealtime = (
  c: DependencyContainer = container,
  config: IV2BroadcastChannelRealtimeConfig = {}
): DependencyContainer => {
  const channelName = config.channelName ?? broadcastChannelDefaults.channelName;
  const logger = c.isRegistered(v2CoreTokens.logger)
    ? c.resolve<ILogger>(v2CoreTokens.logger)
    : undefined;
  const hubResult = getBroadcastChannelRealtimeHub(channelName, logger);
  if (hubResult.isErr()) {
    throw new Error(hubResult.error.message);
  }

  c.registerInstance(v2BroadcastChannelTokens.hub, hubResult.value);
  c.register(v2CoreTokens.realtimeEngine, BroadcastChannelRealtimeEngine, {
    lifecycle: Lifecycle.Singleton,
  });
  const hasTableDeps =
    c.isRegistered(v2CoreTokens.tableRepository) && c.isRegistered(v2CoreTokens.tableMapper);
  if (!hasTableDeps) {
    throw new Error(
      'BroadcastChannel realtime requires tableRepository and tableMapper registrations'
    );
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
  c.register(RecordsDeletedRealtimeProjection, RecordsDeletedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
