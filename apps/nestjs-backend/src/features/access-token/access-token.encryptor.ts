import { authConfig } from '../../configs/auth.config';
import { Encryptor } from '../../utils/encryptor';

interface ITokenEncryptor {
  sign: string;
}

let accessTokenEncryptor: Encryptor<ITokenEncryptor>;

const getAccessTokenEncryptor = () => {
  if (!accessTokenEncryptor) {
    accessTokenEncryptor = new Encryptor<ITokenEncryptor>({
      ...authConfig().accessToken.encryption,
      encoding: 'base64',
    });
  }
  return accessTokenEncryptor;
};

export const getAccessToken = (accessTokenId: string, sign: string) => {
  return `${authConfig().accessToken.prefix}_${accessTokenId}_${getAccessTokenEncryptor().encrypt({
    sign,
  })}`;
};

export const splitAccessToken = (accessToken: string) => {
  const [prefix = '', accessTokenId = '', encryptedSign = ''] = accessToken.split('_');
  if (!accessTokenId) {
    return null;
  }
  if (prefix !== authConfig().accessToken.prefix) {
    return null;
  }
  let sign: string | null = null;
  try {
    sign = getAccessTokenEncryptor().decrypt(encryptedSign).sign;
  } catch (error) {
    return null;
  }
  if (!sign) {
    return null;
  }
  return { prefix, accessTokenId, sign };
};
