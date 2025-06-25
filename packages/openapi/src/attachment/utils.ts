export const pathJoin = (...parts: string[]) => {
  const separator = '/';
  const replace = new RegExp(separator + '+', 'g');
  return parts.join(separator).replace(replace, separator);
};

export const READ_PATH = '/api/attachments/read';

export const getFullStorageUrl = (
  storage: { prefix?: string; provider?: 'local' | 's3' | 'minio' },
  bucket: string,
  path: string
) => {
  const { prefix, provider } = storage;
  if (provider === 'minio') {
    return prefix + pathJoin('/', bucket, path);
  }
  if (provider === 's3') {
    return prefix + pathJoin('/', path);
  }
  return prefix + pathJoin(READ_PATH, bucket, path);
};
