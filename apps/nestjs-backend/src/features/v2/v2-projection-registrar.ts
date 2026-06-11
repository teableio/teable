import { SetMetadata } from '@nestjs/common';
import type { DependencyContainer } from '@teable/v2-di';

/**
 * Metadata marker for Nest providers that contribute V2 projections.
 */
export const V2_PROJECTION_REGISTRAR_METADATA = 'v2:projection-registrar';

/**
 * Marks a Nest provider as a V2 projection registrar that should be discovered
 * during application bootstrap and wired into the shared V2 tsyringe container.
 */
export const V2ProjectionRegistrar = (): ClassDecorator =>
  SetMetadata(V2_PROJECTION_REGISTRAR_METADATA, true);

export interface IV2ProjectionRegistrar {
  registerProjections(container: DependencyContainer): void;
}

export const isV2ProjectionRegistrar = (value: unknown): value is IV2ProjectionRegistrar =>
  typeof value === 'object' &&
  value !== null &&
  'registerProjections' in value &&
  typeof value.registerProjections === 'function';
