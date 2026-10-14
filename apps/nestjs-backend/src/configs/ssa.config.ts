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

const asPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const ssaConfig = registerAs('ssa', () => ({
  /**
   * Single-tenant hardening: when true the backend forces invite-only
   * registration at boot (`disallowSignUp=true`, waitlist disabled).
   */
  singleTenant: asBoolean(process.env.SSA_SINGLE_TENANT, false),
  /**
   * Shared secret for the internal `/api/ssa/*` API used by companion
   * services (header `X-SSA-Token`). Unset disables the internal API.
   */
  internalToken: process.env.SSA_INTERNAL_TOKEN ?? '',
  events: {
    /** Where `table.record.*` events are POSTed. Unset disables forwarding. */
    webhookUrl: process.env.SSA_EVENTS_WEBHOOK_URL ?? '',
    /** HMAC-SHA256 key for the `X-SSA-Signature` header. */
    webhookSecret: process.env.SSA_EVENTS_WEBHOOK_SECRET ?? '',
    /** Forward timeout; events are dropped (logged) after this. */
    timeoutMs: asPositiveNumber(process.env.SSA_EVENTS_TIMEOUT_MS, 3000),
    /** Optional allow-list of table ids whose events are forwarded. */
    tables: asList(process.env.SSA_EVENTS_TABLES),
  },
}));

export const SsaConfig = () => Inject(ssaConfig.KEY);

export type ISsaConfig = ReturnType<typeof ssaConfig>;
