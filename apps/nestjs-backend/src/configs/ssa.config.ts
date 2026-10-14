/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import { registerAs } from '@nestjs/config';

/**
 * SSA single-tenant extensions (fork-only).
 *
 * These variables are additive: when unset, the backend behaves exactly like
 * upstream Teable Community Edition.
 *
 * @see docs/ssa/ENVIRONMENT.md
 */
const asBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value === '') {
    return fallback;
  }
  return value === 'true' || value === '1';
};

export const ssaConfig = registerAs('ssa', () => ({
  /**
   * Single-tenant hardening: when true the backend forces invite-only
   * registration at boot (`disallowSignUp=true`, waitlist disabled).
   */
  singleTenant: asBoolean(process.env.SSA_SINGLE_TENANT, false),
}));

export const SsaConfig = () => Inject(ssaConfig.KEY);

export type ISsaConfig = ReturnType<typeof ssaConfig>;
