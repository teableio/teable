import { describe, expect, it } from 'vitest';

import { upsertRequiredPermissions, upsertUsageIncrement } from './upsert-permissions';

describe('upsertRequiredPermissions', () => {
  it('requires only create for error mode', () => {
    expect(upsertRequiredPermissions('error')).toEqual(['record|create']);
  });

  it('requires create and update for ignore and update modes', () => {
    expect(upsertRequiredPermissions('ignore')).toEqual(['record|create', 'record|update']);
    expect(upsertRequiredPermissions('update')).toEqual(['record|create', 'record|update']);
  });
});

describe('upsertUsageIncrement', () => {
  it('reserves the request rows for error mode (every row inserts)', () => {
    expect(upsertUsageIncrement('error', 100)).toBe(100);
  });

  it('reserves nothing for ignore and update so pure updates are not billed as creates', () => {
    expect(upsertUsageIncrement('ignore', 100)).toBeUndefined();
    expect(upsertUsageIncrement('update', 100)).toBeUndefined();
  });
});
