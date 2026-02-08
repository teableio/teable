import type { DependencyContainer } from '@teable/v2-di';

/**
 * Interface for services that register projections with the V2 container.
 * Enterprise modules can implement this interface and call
 * `V2ContainerService.addProjectionRegistrar(this)` in their `onModuleInit` hook.
 */
export interface IV2ProjectionRegistrar {
  registerProjections(container: DependencyContainer): void;
}
