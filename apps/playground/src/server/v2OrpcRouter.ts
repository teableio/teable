import { trace } from '@opentelemetry/api';
import { v2Tracer } from './otel';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { ActorId, generateUuid, type IExecutionContext } from '@teable/v2-core';

import { PLAYGROUND_ACTOR_ID } from '@/lib/playground/constants';
import { createPlaygroundContainer, warmPlaygroundContainer } from './playgroundContainer';

const actorIdResult = ActorId.create(PLAYGROUND_ACTOR_ID);
if (actorIdResult.isErr()) {
  throw new Error(actorIdResult.error);
}
const playgroundActorId = actorIdResult.value;

const formatAsUuid = (hex: string): string => {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const getRequestId = (): string => {
  const span = trace.getActiveSpan();
  const traceId = span?.spanContext().traceId;
  if (traceId && traceId.length === 32) {
    return formatAsUuid(traceId);
  }
  return generateUuid();
};

const createExecutionContext = (): IExecutionContext => ({
  actorId: playgroundActorId,
  tracer: v2Tracer,
  requestId: getRequestId(),
});

warmPlaygroundContainer();

export const v2OrpcRouter = createV2OrpcRouter({
  createContainer: createPlaygroundContainer,
  createExecutionContext,
});
