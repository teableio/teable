import * as Sentry from '@sentry/nestjs';

/**
 * Single convention for reporting a deliberately-absorbed failure: the caller
 * keeps its fallback behavior (log, degrade, retry) while this makes the
 * failure visible as a Sentry issue. `type` names the seam (e.g.
 * 'ai_proxy.billing_charge_failed') and becomes the event's mechanism. Tags are
 * entry pairs because Sentry tag keys are dot-separated.
 */
export const captureHandledError = (
  error: unknown,
  options: {
    type: string;
    tags?: ReadonlyArray<readonly [key: string, value: string]>;
    context?: { name: string; data: Record<string, unknown> };
  }
): void => {
  Sentry.withScope((scope) => {
    for (const [key, value] of options.tags ?? []) {
      scope.setTag(key, value);
    }
    if (options.context) {
      scope.setContext(options.context.name, options.context.data);
    }
    Sentry.captureException(error, {
      mechanism: { handled: true, type: options.type },
    });
  });
};
