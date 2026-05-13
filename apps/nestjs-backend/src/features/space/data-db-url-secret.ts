import { createHash } from 'crypto';
import { Encryptor } from '../../utils/encryptor';

type IDataDbUrlSecret = {
  url: string;
};

const getDataDbUrlEncryptor = () =>
  new Encryptor<IDataDbUrlSecret>({
    algorithm: process.env.BACKEND_DATA_DB_URL_ENCRYPTION_ALGORITHM ?? 'aes-128-cbc',
    key:
      process.env.BACKEND_DATA_DB_URL_ENCRYPTION_KEY ??
      process.env.BACKEND_ACCESS_TOKEN_ENCRYPTION_KEY ??
      createHash('sha256')
        .update(process.env.SECRET_KEY ?? 'teable-data-db-url-secret')
        .digest('hex')
        .slice(0, 16),
    iv:
      process.env.BACKEND_DATA_DB_URL_ENCRYPTION_IV ??
      process.env.BACKEND_ACCESS_TOKEN_ENCRYPTION_IV ??
      createHash('sha256')
        .update(process.env.SECRET_KEY ?? 'teable-data-db-url-secret-iv')
        .digest('hex')
        .slice(0, 16),
  });

export const encryptDataDbUrl = (url: string) => getDataDbUrlEncryptor().encrypt({ url });

export const decryptDataDbUrl = (encryptedUrl: string) =>
  getDataDbUrlEncryptor().decrypt(encryptedUrl).url;
