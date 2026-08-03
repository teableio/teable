/* eslint-disable @typescript-eslint/naming-convention */
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const nextJsConfig = registerAs('nextJs', () => ({
  dir: process.env.NEXTJS_DIR ?? '../nextjs-app',
}));

/**
 * Express `trust proxy` value. Without it req.ip is the socket peer — the reverse
 * proxy's private address (ALB / nginx / k8s ingress) — instead of the real client
 * IP from X-Forwarded-For, which corrupts audit logs and per-IP rate limiting.
 *
 * BACKEND_TRUST_PROXY accepts the same forms as Express: 'true' / 'false', a hop
 * count ('1'), or a comma-separated list of IPs / CIDRs / preset names.
 * Default trusts only private-network proxies: Express walks X-Forwarded-For from
 * the right and stops at the first public address, so a public client cannot spoof
 * its IP by sending its own X-Forwarded-For header.
 */
export const parseTrustProxy = (raw: string | undefined): boolean | number | string => {
  const value = raw?.trim();
  if (!value) return 'loopback, linklocal, uniquelocal';
  if (value === 'true') return true;
  if (value === 'false') return false;
  const hops = Number(value);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  return value;
};

export const securityWebConfig = registerAs('security.web', () => ({
  cors: {
    enabled: true,
  },
  sessionOriginCheck: {
    enabled: process.env.BACKEND_SESSION_ORIGIN_CHECK_ENABLED === 'true',
  },
  trustProxy: parseTrustProxy(process.env.BACKEND_TRUST_PROXY),
}));

export const tracingConfig = registerAs('tracing', () => ({
  enabled: process.env.TRACING_ENABLED === 'true',
}));

export const apiDocConfig = registerAs('apiDoc', () => ({
  disabled: process.env.API_DOC_DISENABLED === 'true',
  enabledSnippet: process.env.API_DOC_ENABLED_SNIPPET === 'true',
}));

export type INextJsConfig = ConfigType<typeof nextJsConfig>;
export type ISecurityWebConfig = ConfigType<typeof securityWebConfig>;
export type IApiDocConfig = ConfigType<typeof apiDocConfig>;
export const bootstrapConfigs = [nextJsConfig, securityWebConfig, apiDocConfig];
