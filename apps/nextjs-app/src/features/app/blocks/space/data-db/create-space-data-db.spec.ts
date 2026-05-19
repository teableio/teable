import { describe, expect, it } from 'vitest';
import {
  canCreateSpaceWithDataDb,
  getCreateSpaceDataDbPayload,
  isByodbSpaceCreateEnabled,
} from './create-space-data-db';

const byodbUrl = 'postgresql://user:pass@db/teable';

describe('create space data DB helpers', () => {
  it('keeps the default database payload empty', () => {
    expect(getCreateSpaceDataDbPayload('default', byodbUrl)).toEqual({});
    expect(canCreateSpaceWithDataDb('default', '', undefined, undefined)).toBe(true);
  });

  it('builds a trimmed BYODB create-space payload', () => {
    expect(getCreateSpaceDataDbPayload('byodb', ` ${byodbUrl} `)).toEqual({
      dataDb: {
        mode: 'byodb',
        url: byodbUrl,
        targetMode: 'initialize-empty',
      },
    });
  });

  it('requires a successful current preflight before BYODB space creation', () => {
    const url = byodbUrl;

    expect(canCreateSpaceWithDataDb('byodb', url, { ok: false }, url)).toBe(false);
    expect(canCreateSpaceWithDataDb('byodb', `${url}?sslmode=require`, { ok: true }, url)).toBe(
      false
    );
    expect(canCreateSpaceWithDataDb('byodb', url, { ok: true }, url)).toBe(true);
  });

  it('enables BYODB create UX only for EE builds', () => {
    expect(isByodbSpaceCreateEnabled('EE')).toBe(true);
    expect(isByodbSpaceCreateEnabled('CLOUD')).toBe(false);
    expect(isByodbSpaceCreateEnabled(undefined)).toBe(false);
  });
});
