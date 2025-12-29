import {
  FieldCreatedRealtimeProjection,
  TableCreatedRealtimeProjection,
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
  c.register(TableCreatedRealtimeProjection, TableCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(FieldCreatedRealtimeProjection, FieldCreatedRealtimeProjection, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
