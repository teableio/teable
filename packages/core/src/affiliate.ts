/**
 * Affiliate (`?via=`) attribution constants — the single source of truth for
 * every writer and reader of the cookie across the monorepo (Next proxies,
 * NestJS middleware, analytics listeners). The marketing-site repo keeps its
 * own copy by necessity (no shared package).
 * Full cookie contract: apps/nextjs-app/src/lib/affiliate-cookie.ts.
 */
export const AFFILIATE_COOKIE_NAME = 'teable_affiliate_via';

/** Matches the marketing site's cookie and Rewardful's 60-day referral window. */
export const AFFILIATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

/** Cap applied wherever the token is written or ingested. */
export const AFFILIATE_VIA_MAX_LENGTH = 500;
