import { Logger } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IAuditAction, AuditScope } from './audit-scope';

// Module-level logger used by the @Audit wrapper when audit bookkeeping (resolver
// functions, emit) throws. Audit must never propagate its own errors to the caller.
const auditDecoratorLogger = new Logger('AuditDecorator');

/**
 * Context the decorator pre-builds from the host instance and passes as the LAST
 * positional argument to every user-supplied callback (resolver, per-field functions,
 * emit). Lets callbacks be arrow functions while still reading CLS-bound state — no
 * `function(this: T)` ceremony needed.
 *
 * `cls` is read from `host.cls` by convention (every host that uses `@Audit` injects
 * `ClsService` under that name). Passed through as-is so callbacks can pull any CLS key
 * they need (`user.id`, `appId`, etc.).
 */
export interface IAuditCtx {
  cls: ClsService<IClsStore>;
}

/**
 * Auto-emit directive — tells the decorator whether/what to call `audit.emitAtomic(...)`
 * with after the method returns.
 *
 *  - `false` / `undefined` — don't emit (downstream events write the rows).
 *  - `true` — emit ONE row, no extra payload.
 *  - number — emit ONE row, `payload.recordCount = N`.
 *  - object — emit ONE row, fields merged into payload (e.g. `{ emailCount: 5 }`).
 */
export type IAuditEmitDirective = boolean | number | Record<string, unknown>;

/**
 * What a resolver / config produces. Two valid shapes:
 *
 *  - **Operation-opening** — `rootAction` set. Opens a withOperation scope and lets
 *    AuditScope create `operationId` in CLS. Downstream natural events keep their own
 *    atomic `action` and receive this value as `payload.rootAction`.
 *
 *  - **Atomic emit** — `action` + `emit` set. The method writes one atomic audit row at
 *    return. It may also run under an active operation, in which case rootAction and
 *    operationId are attached automatically.
 */
export interface IAuditResolved {
  action?: IAuditAction;
  rootAction?: IAuditAction;
  resourceId?: string;
  params?: Record<string, unknown>;
  userId?: string;
  emit?: IAuditEmitDirective;
}

/**
 * Declarative (object) form. Each field is a constant or a per-arg function. Functions
 * receive the method's args, followed by an `IAuditCtx` (see {@link IAuditCtx}) as the
 * last positional arg — letting them stay arrow-compatible while reading CLS state.
 * `emit` additionally gets the method's return value as the first arg.
 *
 * Signatures are intentionally loose (`...args: any[]`) so TypeScript doesn't reject
 * short callbacks like `(baseId: string) => baseId` that ignore `ctx`. Add
 * `ctx: IAuditCtx` to your callback's params when you actually need CLS access.
 *
 * Three usage patterns:
 *  1. **Operation wrapper, no auto-emit** — `rootAction` set, `emit`
 *     unset. Downstream events write atomic audit rows. E.g. paste/import/duplicate.
 *  2. **Atomic row** — `action` + `resourceId` + `emit`.
 *     One audit row written at return. E.g. login, signup, token, invitation, export.
 *  3. **Atomic leaf under operation** — `action` + `emit` set, no `rootAction` and
 *     optionally no `resourceId`. Emits at return using the caller's operation.
 */
export interface IAuditDeclarativeConfig {
  // Atomic row action. Must be paired with `emit`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action?: IAuditAction | ((...args: any[]) => IAuditAction | undefined);
  // Operation attribution. Downstream rows copy this into payload.rootAction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rootAction?: IAuditAction | ((...args: any[]) => IAuditAction | undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resourceId?: string | ((...args: any[]) => string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: (...args: any[]) => Record<string, unknown> | undefined;
  // Override audit row's user_id (e.g. 'automationRobot').
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId?: (...args: any[]) => string | undefined;
  // Auto-emit directive — see IAuditEmitDirective.
  emit?:
    | IAuditEmitDirective
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | ((...args: any[]) => IAuditEmitDirective | undefined);
}

/**
 * Resolver (function) form. For methods with awkward / many-param signatures where each
 * decorator wants to extract what it needs in one place without forcing the method to
 * reshape its signature. Receives the method's args followed by an `IAuditCtx` last.
 *
 * Return `undefined` to skip both operation and emit. Return `{ action, emit, ... }` for
 * atomic rows. Return `{ rootAction, ... }` for operation-opening mode.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IAuditResolverFn = (...args: any[]) => IAuditResolved | undefined;

export type IAuditConfig = IAuditDeclarativeConfig | IAuditResolverFn;

/**
 * Single decorator for all audit needs. Requires the host class to have an
 * `audit: AuditScope` property (constructor-injected).
 *
 * Decision tree:
 *  - Method is an audit operation entry point?
 *      - Set `rootAction`. The decorator opens an operation and AuditScope generates
 *        `operationId` in CLS. Downstream events keep atomic action and receive this
 *        value as `payload.rootAction`.
 *  - Method is called inside an outer audit operation and does raw SQL that bypasses
 *    natural events?
 *      - Set `action` + `emit` so the row action is explicit.
 *  - Method itself is one atomic audit row?
 *      - Set `action` + `resourceId` + `emit`.
 *
 * For non-method entry points (BullMQ workers, request middleware), call
 * `audit.withOperation(...)` directly.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Audit(config: IAuditConfig): MethodDecorator {
  // eslint-disable-next-line @typescript-eslint/ban-types
  return function (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = descriptor.value as (...args: any[]) => any;
    if (typeof original !== 'function') {
      throw new Error('@Audit can only decorate methods.');
    }

    descriptor.value = async function (
      this: {
        audit?: AuditScope;
        cls?: ClsService<IClsStore>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } & Record<string, any>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...args: any[]
    ) {
      const audit = this.audit;
      if (!audit) {
        throw new Error(
          `@Audit requires the host class to have an 'audit' property of type AuditScope.`
        );
      }
      if (!this.cls) {
        throw new Error(
          `@Audit requires the host class to have a 'cls' property of type ClsService.`
        );
      }
      const ctx: IAuditCtx = { cls: this.cls };

      // Resolver functions are user-supplied (action/resourceId/params/emit closures).
      // If one throws, that's an audit-config bug — never let it break the wrapped
      // business method. Swallow + log, then continue without audit for this call.
      let resolved: IAuditResolved | undefined;
      try {
        resolved = resolveAuditConfig.call(this, config, args, ctx);
      } catch (err) {
        auditDecoratorLogger.error(
          `audit resolver threw, skipping audit for this call: ${(err as Error)?.message ?? err}`,
          (err as Error)?.stack
        );
        return original.apply(this, args);
      }
      if (!resolved) {
        return original.apply(this, args);
      }

      const opensOperation = !!resolved.rootAction;

      // Atomic-only mode: don't open an operation; rely on explicit resourceId or the
      // caller's active operation.
      // emitAtomic() is a no-op if no resourceId can be resolved.
      if (!opensOperation) {
        const result = await original.apply(this, args);
        // Original method already succeeded — protect its return value from any
        // failure in audit emission (emit handlers, payload-resolver closures, etc.).
        try {
          await emitFromConfig(this, audit, config, resolved, result, args, ctx);
        } catch (err) {
          auditDecoratorLogger.error(
            `audit atomic emit failed, result preserved: ${(err as Error)?.message ?? err}`,
            (err as Error)?.stack
          );
        }
        return result;
      }

      // Operation-opening mode.
      return audit.withOperation(
        resolved as Required<Pick<IAuditResolved, 'rootAction'>> & IAuditResolved,
        async () => {
          // Business method's exceptions MUST propagate — only audit failures are swallowed.
          const result = await original.apply(this, args);
          try {
            await emitFromConfig(this, audit, config, resolved!, result, args, ctx);
          } catch (err) {
            auditDecoratorLogger.error(
              `audit emit (scope) failed, result preserved: ${(err as Error)?.message ?? err}`,
              (err as Error)?.stack
            );
          }
          return result;
        }
      );
    };

    return descriptor;
  };
}

async function emitFromConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  host: any,
  audit: AuditScope,
  config: IAuditConfig,
  resolved: IAuditResolved,
  result: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
  ctx: IAuditCtx
): Promise<void> {
  let directive: IAuditEmitDirective | undefined;
  if (typeof config === 'function') {
    directive = resolved.emit;
  } else if (typeof config.emit === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    directive = (config.emit as (...rest: any[]) => IAuditEmitDirective | undefined).apply(host, [
      result,
      ...args,
      ctx,
    ] as never);
  } else {
    directive = config.emit;
  }

  if (!directive) return;

  const extra =
    directive === true
      ? undefined
      : typeof directive === 'number'
        ? directive >= 0
          ? { recordCount: directive }
          : undefined
        : (directive as Record<string, unknown>);
  if (!resolved.action) {
    auditDecoratorLogger.error('audit emit skipped: `action` is required when `emit` is set');
    return;
  }

  await audit.emitAtomic({
    action: resolved.action,
    resourceId: resolved.resourceId,
    ...(resolved.userId ? { userId: resolved.userId } : {}),
    payload: extra,
    params: resolved.params,
  });
}

function resolveAuditConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  this: any,
  config: IAuditConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
  ctx: IAuditCtx
): IAuditResolved | undefined {
  // Function (resolver) form — caller picks fields out of args itself.
  if (typeof config === 'function') {
    return normalizeAuditResolved(
      (config as IAuditResolverFn).apply(this, [...args, ctx] as never)
    );
  }

  return resolveDeclarativeAuditConfig.call(this, config, args, ctx);
}

function normalizeAuditResolved(resolved?: IAuditResolved): IAuditResolved | undefined {
  if (!resolved) return undefined;
  const opensOperation = !!resolved.rootAction;
  const emitsAtomic = !!(resolved.action && resolved.emit != null);
  if (!opensOperation && !emitsAtomic) return undefined;
  return resolved;
}

function resolveDeclarativeAuditConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  this: any,
  config: IAuditDeclarativeConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
  ctx: IAuditCtx
): IAuditResolved | undefined {
  const argsWithCtx = [...args, ctx];
  const action =
    typeof config.action === 'function'
      ? config.action.apply(this, argsWithCtx as never)
      : config.action;
  const rootAction =
    typeof config.rootAction === 'function'
      ? config.rootAction.apply(this, argsWithCtx as never)
      : config.rootAction;
  const resourceId =
    typeof config.resourceId === 'function'
      ? config.resourceId.apply(this, argsWithCtx as never)
      : config.resourceId;

  const opensOperation = !!rootAction;
  const emitsAtomic = !!(action && config.emit != null);
  if (!opensOperation && !emitsAtomic) return undefined;

  return {
    action,
    rootAction,
    resourceId,
    params: config.params?.apply(this, argsWithCtx as never),
    userId: config.userId?.apply(this, argsWithCtx as never),
    emit: typeof config.emit === 'function' ? undefined : config.emit,
  };
}
