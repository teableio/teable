export const pathJoin = (...parts: string[]) => {
  const separator = '/';
  const replace = new RegExp(separator + '+', 'g');
  return parts.join(separator).replace(replace, separator);
};

export const READ_PATH = '/api/attachments/read';

export const getPublicFullStorageUrl = (
  storage: {
    provider?: 'local' | 's3' | 'minio';
    prefix?: string;
    publicBucket?: string;
    publicUrl?: string;
  },
  bucket: string = '',
  path: string = ''
) => {
  const { prefix, provider, publicUrl, publicBucket } = storage;
  const _bucket = bucket || publicBucket || '';

  if (publicUrl) {
    return publicUrl + pathJoin('/', path);
  }
  if (provider === 'minio') {
    return prefix + pathJoin('/', _bucket, path);
  }
  if (provider === 's3') {
    return prefix + pathJoin('/', path);
  }
  return prefix + pathJoin(READ_PATH, _bucket, path);
};
