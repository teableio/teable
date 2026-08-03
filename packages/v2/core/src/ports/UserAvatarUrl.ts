const READ_PUBLIC_AVATAR_PREFIX = '/api/attachments/read/public/avatar/';

const pathJoin = (...parts: string[]): string =>
  parts.join('/').replace(/\/+/g, '/').replace(':/', '://');

const withTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);

export const resolveUserAvatarUrlPrefix = (env: NodeJS.ProcessEnv = process.env): string => {
  const provider = env.BACKEND_STORAGE_PROVIDER ?? 'local';
  const storagePrefix = env.STORAGE_PREFIX ?? env.PUBLIC_ORIGIN ?? '';
  const publicUrl = env.BACKEND_STORAGE_PUBLIC_URL;
  const publicBucket = env.BACKEND_STORAGE_PUBLIC_BUCKET || 'public';

  if (publicUrl) {
    return withTrailingSlash(pathJoin(publicUrl, 'avatar'));
  }

  if (provider === 's3' || provider === 'aliyun') {
    return withTrailingSlash(pathJoin(storagePrefix, 'avatar'));
  }

  if (provider === 'minio') {
    return withTrailingSlash(pathJoin(storagePrefix, publicBucket, 'avatar'));
  }

  return withTrailingSlash(pathJoin(storagePrefix, READ_PUBLIC_AVATAR_PREFIX));
};

export const buildUserAvatarUrl = (userId: string, env: NodeJS.ProcessEnv = process.env): string =>
  `${resolveUserAvatarUrlPrefix(env)}${userId}`;
