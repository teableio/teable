import type { INestApplication } from '@nestjs/common';
import { AuthService } from '../../src/features/auth/auth.service';
import { JwtAuthInternalType } from '../../src/features/auth/strategies/types';

/**
 * An App-type internal token scoped to `baseId`. The enterprise edition only
 * accepts the token a live app stores, so it overrides this helper with one
 * that also creates that app (backend-ee override-config).
 */
export const createAppToken = async (app: INestApplication, baseId: string): Promise<string> =>
  (await app.get(AuthService).getTempInternalToken(baseId, JwtAuthInternalType.App)).accessToken;
