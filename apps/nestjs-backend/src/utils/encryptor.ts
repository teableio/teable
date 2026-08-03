import * as crypto from 'crypto';

interface IEncryptionOptions {
  algorithm: string;
  key: string | Buffer;
  iv: string | Buffer;
  encoding?: BufferEncoding;
}

export class Encryptor<T> {
  private readonly options: Required<IEncryptionOptions>;

  constructor(options: IEncryptionOptions) {
    this.options = {
      ...options,
      encoding: options.encoding ?? 'hex',
    };
  }

  encrypt(data: T): string {
    try {
      const { algorithm, key, iv, encoding } = this.options;
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      const encrypted = cipher.update(JSON.stringify(data), 'utf-8', encoding);
      return encrypted + cipher.final(encoding);
    } catch (error) {
      throw new Error('Encryption failed');
    }
  }

  decrypt(encryptedData: string): T {
    try {
      const { algorithm, key, iv, encoding } = this.options;
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      const decrypted = decipher.update(encryptedData, encoding, 'utf-8');
      return JSON.parse(decrypted + decipher.final('utf-8')) as T;
    } catch (error) {
      throw new Error('Decryption failed');
    }
  }
}

export const getEncryptor = <T>(options: IEncryptionOptions) => new Encryptor<T>(options);
