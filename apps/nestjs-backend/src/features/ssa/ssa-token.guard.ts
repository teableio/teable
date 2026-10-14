import { createHash, timingSafeEqual } from 'node:crypto';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { SsaConfig, ISsaConfig } from '../../configs/ssa.config';

/** Constant-time string comparison via fixed-size digests. */
export const safeEqual = (received: string, expected: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(received).digest(),
    createHash('sha256').update(expected).digest()
  );

export const SSA_TOKEN_HEADER = 'x-ssa-token';

/**
 * Guards the internal `/api/ssa/*` API. Fails closed when no token is
 * configured; otherwise requires a constant-time match of `X-SSA-Token`.
 */
@Injectable()
export class SsaTokenGuard implements CanActivate {
  constructor(@SsaConfig() private readonly ssaConfig: ISsaConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.ssaConfig.internalToken;
    if (!expected) {
      throw new ForbiddenException('SSA internal API is disabled (SSA_INTERNAL_TOKEN unset)');
    }

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const received = request.headers?.[SSA_TOKEN_HEADER];

    if (typeof received !== 'string' || !safeEqual(received, expected)) {
      throw new ForbiddenException('Invalid SSA internal token');
    }

    return true;
  }
}
