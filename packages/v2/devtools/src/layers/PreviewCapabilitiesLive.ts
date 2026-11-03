import { createCorePreviewPlannerRegistry } from '@teable/v2-command-explain';
import type { DependencyContainer } from '@teable/v2-di';
import { Effect, Layer } from 'effect';

import { PreviewCapabilities } from '../services/PreviewCapabilities';

/**
 * Capability metadata is defined by the canonical registrations. Their planner dependencies are
 * never invoked while reading metadata, so discovery does not need to open a database.
 */
const metadataOnlyContainer = {
  resolve: <T>() => Object.freeze({}) as T,
} as unknown as DependencyContainer;

const capabilities = createCorePreviewPlannerRegistry(metadataOnlyContainer).capabilities();

export const PreviewCapabilitiesLive = Layer.succeed(PreviewCapabilities, {
  list: () => Effect.succeed(capabilities),
});
