import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { ActorId, type IExecutionContext } from '@teable/v2-core';

import { PLAYGROUND_ACTOR_ID } from '@/lib/playground/constants';
import { createPlaygroundContainer, warmPlaygroundContainer } from './playgroundContainer';

const actorIdResult = ActorId.create(PLAYGROUND_ACTOR_ID);
if (actorIdResult.isErr()) {
  throw new Error(actorIdResult.error);
}
const playgroundActorId = actorIdResult.value;

const createExecutionContext = (): IExecutionContext => ({
  actorId: playgroundActorId,
});

warmPlaygroundContainer();

export const v2OrpcRouter = createV2OrpcRouter({
  createContainer: createPlaygroundContainer,
  createExecutionContext,
});
