import type { ICommandBus, IExecutionContext, IPublicCommand, IQueryBus } from '@teable/v2-core';
import { ActorId, v2CoreTokens } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

export const createReproContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('cli-repro-computed');
  if (actorIdResult.isErr()) throw actorIdResult.error;
  return { actorId: actorIdResult.value };
};

export const executeReproCommand = async <TCommand extends IPublicCommand, TResult>(
  container: DependencyContainer,
  command: TCommand
): Promise<TResult> => {
  const commandBus = container.resolve(v2CoreTokens.commandBus) as ICommandBus;
  const result = await commandBus.execute<TCommand, TResult>(createReproContext(), command);
  if (result.isErr()) throw result.error;
  return result.value;
};

export const getReproQueryBus = (container: DependencyContainer): IQueryBus =>
  container.resolve(v2CoreTokens.queryBus) as IQueryBus;
