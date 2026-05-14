import { describe, expect, it } from 'vitest';

import { buildUserAvatarUrl, resolveUserAvatarUrlPrefix } from './userAvatarUrl';

describe('userAvatarUrl', () => {
  it('keeps the local public read endpoint by default', () => {
    expect(resolveUserAvatarUrlPrefix({})).toBe('/api/attachments/read/public/avatar/');
  });

  it('uses public storage URLs for s3 avatars', () => {
    const env = {
      BACKEND_STORAGE_PROVIDER: 's3',
      STORAGE_PREFIX: 'https://s3.us-west-2.amazonaws.com/storage-public.teable.io',
    };

    expect(buildUserAvatarUrl('usr1', env)).toBe(
      'https://s3.us-west-2.amazonaws.com/storage-public.teable.io/avatar/usr1'
    );
  });
});
