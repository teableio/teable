import type { ILogger } from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';
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
    throw new Error(hubResult.error);
  }

  c.registerInstance(v2BroadcastChannelTokens.hub, hubResult.value);
  c.register(v2CoreTokens.realtimeEngine, BroadcastChannelRealtimeEngine, {
    lifecycle: Lifecycle.Singleton,
  });

  return c;
};
