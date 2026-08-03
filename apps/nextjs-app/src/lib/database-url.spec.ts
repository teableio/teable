import { describe, expect, it } from 'vitest';
import { getAppDatabaseUrl } from './database-url';

describe('getAppDatabaseUrl', () => {
  const metaUrl = 'postgresql://meta';
  const legacyUrl = 'postgresql://legacy';

  const asEnv = (env: Record<string, string>) => env as NodeJS.ProcessEnv;

  it('prefers the split meta database url', () => {
    expect(
      getAppDatabaseUrl(
        asEnv({
          PRISMA_META_DATABASE_URL: metaUrl,
          PRISMA_DATABASE_URL: legacyUrl,
        })
      )
    ).toBe(metaUrl);
  });

  it('falls back to the legacy alias and DATABASE_URL', () => {
    expect(getAppDatabaseUrl(asEnv({ PRISMA_DATABASE_URL: legacyUrl }))).toBe(legacyUrl);
    expect(getAppDatabaseUrl(asEnv({ DATABASE_URL: 'postgresql://database-url' }))).toBe(
      'postgresql://database-url'
    );
  });

  it('throws when no database url exists', () => {
    expect(() => getAppDatabaseUrl(asEnv({}))).toThrow('Missing database url');
  });
});
