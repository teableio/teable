import type { Readable as ReadableStream } from 'node:stream';
import { resolve } from 'path';
import { HttpErrorCode } from '@teable/core';
import { UploadType } from '@teable/openapi';
import { storageConfig } from '../../../configs/storage';
import { CustomHttpException } from '../../../custom.exception';
import type {
  IListObjectsOptions,
  IListObjectsResult,
  IObjectMeta,
  IPresignParams,
  IPresignRes,
} from './types';

export default abstract class StorageAdapter {
  static readonly TEMPORARY_DIR = resolve(process.cwd(), '.temporary');

  static readonly getBucket = (type: UploadType) => {
    switch (type) {
      case UploadType.Table:
      case UploadType.Import:
      case UploadType.ExportBase:
      case UploadType.Comment:
      case UploadType.App:
      case UploadType.ChatFile:
      case UploadType.Automation:
      case UploadType.RecordHistory:
      case UploadType.RecordRemoval:
      case UploadType.Artifact:
      case UploadType.WorkflowRunCold:
      case UploadType.AuditLogCold:
        return storageConfig().privateBucket;
      case UploadType.Avatar:
      case UploadType.OAuth:
      case UploadType.Form:
      case UploadType.Plugin:
      case UploadType.Logo:
      case UploadType.Template:
      case UploadType.ChatDataVisualizationCode:
      case UploadType.SpaceAvatar:
        return storageConfig().publicBucket;
      default:
        throw new CustomHttpException('Invalid upload type', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.attachment.invalidUploadType',
          },
        });
    }
  };

  static readonly getDir = (type: UploadType): string => {
    switch (type) {
      case UploadType.Table:
        return 'table';
      case UploadType.Avatar:
        return 'avatar';
      case UploadType.Form:
        return 'form';
      case UploadType.OAuth:
        return 'oauth';
      case UploadType.Import:
        return 'import';
      case UploadType.Plugin:
        return 'plugin';
      case UploadType.Comment:
        return 'comment';
      case UploadType.Logo:
        return 'logo';
      case UploadType.ExportBase:
        return 'export-base';
      case UploadType.Template:
        return 'template';
      case UploadType.ChatDataVisualizationCode:
        return 'chat-data-visualization-code';
      case UploadType.App:
        return 'app';
      case UploadType.ChatFile:
        return 'chat-file';
      case UploadType.Automation:
        return 'automation';
      case UploadType.RecordHistory:
        return 'record-history';
      case UploadType.SpaceAvatar:
        return 'space-avatar';
      case UploadType.RecordRemoval:
        return 'record-removal';
      case UploadType.WorkflowRunCold:
        return 'workflow-run';
      case UploadType.AuditLogCold:
        return 'audit-log';
      case UploadType.Artifact:
        return 'artifact';
      default:
        throw new CustomHttpException('Invalid upload type', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.attachment.invalidUploadType',
          },
        });
    }
  };

  static readonly isPublicBucket = (bucket: string) => {
    return bucket === storageConfig().publicBucket;
  };

  /**
   * Cache-Control injected into presigned GET urls of private-bucket objects
   * at sign time (covers legacy and new objects alike). private = browser
   * cache only; max-age stays below the presigned url reuse window
   * (urlExpireIn * 0.5), after which the url — and thus the cache key —
   * rotates anyway, and it also bounds how long a revoked user can still see
   * a locally cached copy.
   */
  static readonly PRIVATE_PREVIEW_CACHE_CONTROL = 'private, max-age=86400';

  /**
   * Cache-Control stored as object metadata at upload time. Public-bucket types
   * only: private-bucket objects are served through presigned GET urls whose
   * caching is controlled at sign time, not on the object.
   */
  static readonly getCacheControl = (type: UploadType): string | undefined => {
    switch (type) {
      // presigned uploads keyed by content hash / random token, never overwritten
      case UploadType.Template:
      case UploadType.Form:
      case UploadType.OAuth:
      case UploadType.ChatDataVisualizationCode:
        return 'public, max-age=31536000, immutable';
      // fixed keys overwritten in place. Avatar urls carry a ?v= version
      // query where stored, but table cell values (user/createdBy/
      // lastModifiedBy) rebuild the url without it, and logo/plugin have no
      // busting at all — staleness after an overwrite is bounded by this
      // max-age, so keep it short.
      case UploadType.Avatar:
      case UploadType.SpaceAvatar:
      case UploadType.Logo:
      case UploadType.Plugin:
        return 'public, max-age=3600';
      default:
        return undefined;
    }
  };

  /**
   * generate presigned url
   * @param bucket bucket name
   * @param dir storage dir
   * @param params presigned params, limit presigned url upload file
   * @returns presigned url and upload params
   */
  abstract presigned(bucket: string, dir: string, params: IPresignParams): Promise<IPresignRes>;

  /**
   * get object meta
   * @param bucket bucket name
   * @param path path name
   * @param token presigned token
   * @returns object meta
   */
  abstract getObjectMeta(bucket: string, path: string, token: string): Promise<IObjectMeta>;

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
  ): Promise<{ hash: string; path: string }>;

  /**
   * uploadFile with file stream
   * @param bucket bucket name
   * @param path path name
   * @param stream file stream
   * @param metadata Metadata of the object.
   */
  abstract uploadFile(
    bucket: string,
    path: string,
    stream: Buffer | ReadableStream,
    metadata?: Record<string, unknown>
  ): Promise<{ hash: string; path: string }>;

  abstract uploadFileStream(
    bucket: string,
    path: string,
    stream: Buffer | ReadableStream,
    metadata?: Record<string, unknown>
  ): Promise<{ hash: string; path: string }>;

  /**
   * cut image
   * @param bucket bucket name
   * @param path path name
   * @param width width
   * @param height height
   * @param newPath save as new path
   * @returns cut image url
   */
  abstract cropImage(
    bucket: string,
    path: string,
    width?: number,
    height?: number,
    newPath?: string
  ): Promise<string>;

  abstract downloadFile(bucket: string, path: string): Promise<ReadableStream>;

  /**
   * list objects under a prefix (paginated internally; returns the full result)
   * @param bucket bucket name
   * @param prefix key prefix, e.g. `record-history/v1/tblxxx/`
   * @param options delimiter groups keys into `prefixes` like S3 common prefixes
   */
  abstract listObjects(
    bucket: string,
    prefix: string,
    options?: IListObjectsOptions
  ): Promise<IListObjectsResult>;

  abstract deleteDir(bucket: string, path: string, throwError?: boolean): Promise<void>;

  /**
   * delete a single file
   * @param bucket bucket name
   * @param path path name
   */
  abstract deleteFile(bucket: string, path: string): Promise<void>;
}
