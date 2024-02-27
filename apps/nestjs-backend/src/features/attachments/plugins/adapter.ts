import { BadRequestException } from '@nestjs/common';
import { UploadType } from '@teable/openapi';
import { storageConfig } from '../../../configs/storage';
import type { IObjectMeta, IPresignParams, IPresignRes } from './types';

export default abstract class StorageAdapter {
  static readonly getBucket = (type: UploadType) => {
    switch (type) {
      case UploadType.Table:
        return storageConfig().privateBucket;
      case UploadType.Avatar:
      case UploadType.Form:
        return storageConfig().publicBucket;
      default:
        throw new BadRequestException('Invalid upload type');
    }
  };

  static readonly getDir = (type: UploadType) => {
    switch (type) {
      case UploadType.Table:
        return 'table';
      case UploadType.Avatar:
        return 'avatar';
      case UploadType.Form:
        return 'form';
      default:
        throw new BadRequestException('Invalid upload type');
    }
  };

  static readonly isPublicBucket = (bucket: string) => {
    return bucket === storageConfig().publicBucket;
  };

  /**
   * generate presigned url
   * @param bucket bucket name
   * @param dir storage dir
   * @param params presigned params, limit presigned url upload file
   * @returns presigned url and upload params
   */
  abstract presigned(bucket: string, dir: string, params?: IPresignParams): Promise<IPresignRes>;

  /**
   * get object meta
   * @param bucket bucket name
   * @param path path name
   * @param token presigned token
   * @returns object meta
   */
  abstract getObject(bucket: string, path: string, token: string): Promise<IObjectMeta>;

  /**
   * get preview url
   * @param bucket bucket name
   * @param path path name
   * @param respHeaders response headers, example: { 'Content-Type': 'images/png' }
   */
  abstract getPreviewUrl(
    bucket: string,
    path: string,
    expiresIn?: number,
    respHeaders?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    }
  ): Promise<string>;

  /**
   * uploadFile with file path
   * @param bucket bucket name
   * @param path path name
   * @param filePath file path
   * @param metadata Metadata of the object.
   */
  abstract uploadFileWidthPath(
    bucket: string,
    path: string,
    filePath: string,
    metadata: Record<string, unknown>
  ): Promise<string>;
}
