import {
  AccessTokenPreset,
  accessTokenPresets,
  getAccessTokenPresetScopes,
  getPermissions,
} from '@teable/core';
import { describe, expect, it } from 'vitest';
import { accessTokenScopesSchema } from './scopes';

describe('platform-session-only App identity grants', () => {
  it('rejects both identity grants in personal token requests, including alongside otherwise valid scopes', () => {
    expect(accessTokenScopesSchema.safeParse(['app|read']).success).toBe(true);
    expect(accessTokenScopesSchema.safeParse(['app|readUsers']).success).toBe(false);
    expect(accessTokenScopesSchema.safeParse(['app|read', 'app|readUserPii']).success).toBe(false);
    for (const preset of accessTokenPresets) {
      expect(getAccessTokenPresetScopes(preset)).not.toContain('app|readUsers');
      expect(getAccessTokenPresetScopes(preset)).not.toContain('app|readUserPii');
    }
    expect(getAccessTokenPresetScopes(AccessTokenPreset.FullAccess)).toContain('app|update');
  });

  it('grants metadata to effective owner/creator and identity PII only to owner', () => {
    expect(getPermissions('owner')).toEqual(
      expect.arrayContaining(['app|readUsers', 'app|readUserPii'])
    );
    expect(getPermissions('creator')).toContain('app|readUsers');
    expect(getPermissions('creator')).not.toContain('app|readUserPii');
    for (const role of ['editor', 'commenter', 'viewer'] as const) {
      expect(getPermissions(role)).not.toContain('app|readUsers');
      expect(getPermissions(role)).not.toContain('app|readUserPii');
    }
  });
});
