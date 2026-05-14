import { describe, expect, it } from 'vitest';

import { buildUserAvatarUrl, resolveUserAvatarUrlPrefix } from './UserAvatarUrl';

describe('UserAvatarUrl', () => {
  it('falls back to the app attachment endpoint for local storage', () => {
    expect(resolveUserAvatarUrlPrefix({})).toBe('/api/attachments/read/public/avatar/');
  });

  it('uses BACKEND_STORAGE_PUBLIC_URL when configured', () => {
    const env = { BACKEND_STORAGE_PUBLIC_URL: 'https://storage-public.teable.io' };

    expect(buildUserAvatarUrl('usr1', env)).toBe('https://storage-public.teable.io/avatar/usr1');
  });

  it('uses object storage prefixes for S3-compatible providers', () => {
    const env = {
      BACKEND_STORAGE_PROVIDER: 's3',
      STORAGE_PREFIX: 'https://s3.us-west-2.amazonaws.com/storage-public.teable.io',
    };

    expect(resolveUserAvatarUrlPrefix(env)).toBe(
      'https://s3.us-west-2.amazonaws.com/storage-public.teable.io/avatar/'
    );
  });
});
