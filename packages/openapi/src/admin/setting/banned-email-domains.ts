/**
 * Normalize raw admin input (textarea / comma separated) into a clean list of
 * banned email domains: trimmed, lowercased, no leading '@', deduplicated.
 */
export const normalizeBannedEmailDomains = (input: string): string[] => {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
    )
  );
};

// Requires a registrable domain (at least one dot-separated label before an
// alphabetic TLD): a bare TLD like `cn` would otherwise ban every .cn address
// through the subdomain rule below.
const BANNED_EMAIL_DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export const isValidBannedEmailDomain = (domain: string): boolean => {
  return domain.length <= 253 && BANNED_EMAIL_DOMAIN_REGEX.test(domain);
};

/**
 * Whether the email's domain matches one of the banned domains.
 * A banned domain also bans its subdomains (banning `tankmail.cn` bans `a.tankmail.cn`).
 */
export const isEmailDomainBanned = (email: string, bannedDomains?: string[] | null): boolean => {
  if (!bannedDomains?.length) {
    return false;
  }
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) {
    return false;
  }
  return bannedDomains.some((banned) => {
    const normalized = banned.trim().replace(/^@/, '').toLowerCase();
    return Boolean(normalized) && (domain === normalized || domain.endsWith(`.${normalized}`));
  });
};
