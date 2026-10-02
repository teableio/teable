import type { NestApplicationOptions } from '@nestjs/common';

/**
 * Nest 11+ keys dynamic modules by object reference, so every `SomeModule.register()` call
 * site (MailSenderModule alone has a dozen) would get its own module instance with its own
 * transports and pools. `deep-hash` restores the Nest 10 behaviour of merging dynamic
 * modules whose definitions are identical. Spread it into every NestFactory / testing
 * module call so the app, the workers and the e2e harness share one module graph shape.
 */
export const nestModuleIdOptions = {
  moduleIdGeneratorAlgorithm: 'deep-hash',
} satisfies Pick<NestApplicationOptions, 'moduleIdGeneratorAlgorithm'>;

const routeDiagnosticsEnabled = process.env.ROUTE_DIAGNOSTICS === '1';

/**
 * Route conflict diagnostics and resolution (Nest 12), applied to every HTTP app (both
 * bootstraps and both e2e harnesses).
 *
 * - 'specificity' registers literal segments before parametric and wildcard ones, so
 *   `/api/base/shared-base` beats `/api/base/:baseId` no matter which controller or module
 *   declared it first. Identical routes keep declaration order (the sort is stable), which is
 *   what the EE override controllers rely on.
 * - Duplicate routes: the community app has none, so every duplicate is a mistake and is
 *   reported. The EE app registers its override controllers on the same paths as the community
 *   controllers it imports (300+ pairs by design), so it passes `duplicateRoutesExpected` and
 *   only reports them under `ROUTE_DIAGNOSTICS=1`; `test/override-route-precedence` in
 *   backend-ee asserts the override wins each of those pairs.
 * - Shadow reports are only useful for an audit: with specificity active every remaining
 *   "shadow" is a literal route declared ahead of a parametric sibling (58 such pairs at the
 *   time of writing), so they stay off unless `ROUTE_DIAGNOSTICS=1` is set.
 */
export const createNestRouteDiagnosticsOptions = ({
  duplicateRoutesExpected = false,
}: { duplicateRoutesExpected?: boolean } = {}) => {
  return {
    routeConflictPolicy: {
      duplicate: duplicateRoutesExpected && !routeDiagnosticsEnabled ? 'off' : 'warn',
      shadow: routeDiagnosticsEnabled ? 'warn' : 'off',
    },
    routeResolutionStrategy: 'specificity',
  } satisfies Pick<NestApplicationOptions, 'routeConflictPolicy' | 'routeResolutionStrategy'>;
};

export const nestRouteDiagnosticsOptions = createNestRouteDiagnosticsOptions();
