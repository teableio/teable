/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  unlinkSync,
  existsSync,
  rmSync,
  promises as fsp,
} from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { type Readable as ReadableStream } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable, Logger } from '@nestjs/common';
import { getRandomString, HttpErrorCode, isImage } from '@teable/core';
import { READ_PATH, UploadType } from '@teable/openapi';
import type { Request } from 'express';
import * as fse from 'fs-extra';
import { ClsService } from 'nestjs-cls';
import sharp from 'sharp';
import { CacheService } from '../../../cache/cache.service';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import { IStorageConfig, StorageConfig } from '../../../configs/storage';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { FileUtils } from '../../../utils';
import { normalizeImageDimensions } from '../../../utils/image-orientation';
import { second } from '../../../utils/second';
import { ATTACHMENT_THUMBNAIL_WEBP_QUALITY } from '../constant';
import { forceAttachmentDisposition, getThumbnailResizeOptions } from '../utils';
import StorageAdapter from './adapter';
import { LocalReadTokenCodec, type ILocalReadTokenParams } from './local-read-token';
import { normalizeObjectPath, resolveWithinStorage } from './local.helper';
import type {
  ILocalFileUpload,
  IListObjectsOptions,
  IListObjectsResult,
  IObjectMeta,
  IPresignParams,
  IRespHeaders,
} from './types';
import { isBodyParserFallback } from './utils';

const UPLOAD_STAGING_DIRECTORY = /^\.upload-[A-Za-z0-9]{6}$/;
const UPLOAD_STAGING_HEARTBEAT_MS = 60 * 1000;
// Shared local volumes need a lease, not a startup purge. A process paused for
// more than a day can lose its staging directory; publication checks ownership.
const UPLOAD_STAGING_STALE_MS = 24 * 60 * 60 * 1000;

/** The page `startAfter` and `maxKeys` ask for, cut from keys in order. */
const pageOf = <T extends { key: string }>(objects: T[], options?: IListObjectsOptions): T[] => {
  const startAfter = options?.startAfter;
  const after = startAfter ? objects.filter(({ key }) => key > startAfter) : objects;
  return options?.maxKeys ? after.slice(0, options.maxKeys) : after;
};

@Injectable()
export class LocalStorage implements StorageAdapter {
  private static readonly activeUploads = new Set<string>();
  private readonly logger = new Logger(LocalStorage.name);
  path: string;
  storageDir: string;
  readTokenCodec: LocalReadTokenCodec;
  static readonly readPath = READ_PATH;

  constructor(
    @StorageConfig() readonly config: IStorageConfig,
    @BaseConfig() readonly baseConfig: IBaseConfig,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<IClsStore>
  ) {
    this.readTokenCodec = new LocalReadTokenCodec(this.config.encryption.entries);
    this.path = this.config.local.path;
    this.storageDir = resolve(process.cwd(), this.path);
    fse.ensureDirSync(StorageAdapter.TEMPORARY_DIR);
    fse.ensureDirSync(this.storageDir);
  }

  private getUploadUrl(token: string, internal?: boolean) {
    const baseUrl = internal ? `http://localhost:${process.env.PORT}` : '';
    return `${baseUrl}/api/attachments/upload/${token}`;
  }

  private deleteLocalFile(filePath: string) {
    try {
      unlinkSync(filePath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  private getUrl(bucket: string, path: string, params: ILocalReadTokenParams) {
    // The token is sealed to this one object: presenting it on any other read
    // path fails verification (see verifyReadToken).
    const objectPath = join(bucket, path);
    const token = this.readTokenCodec.encode({ ...params, path: objectPath });
    const responseContentDisposition = params.respHeaders?.['Content-Disposition'];
    return `${join(LocalStorage.readPath, objectPath)}?token=${token}${responseContentDisposition ? `&response-content-disposition=${encodeURIComponent(responseContentDisposition)}` : ''}`;
  }

  parsePath(path: string) {
    const parts = path.split('/');
    return {
      bucket: parts[0],
      token: parts[parts.length - 1],
    };
  }

  async presigned(_bucket: string, dir: string, params: IPresignParams) {
    const { contentType, contentLength, hash, internal } = params;
    const token = getRandomString(12);
    const filename = hash ?? token;
    const expiresIn = params?.expiresIn ?? second(this.config.tokenExpireIn);
    await this.cacheService.set(
      `attachment:local-signature:${token}`,
      {
        expiresDate: Math.floor(Date.now() / 1000) + expiresIn,
        contentLength,
        contentType,
      },
      expiresIn
    );

    const path = join(dir, filename);
    return {
      token,
      path,
      url: this.getUploadUrl(token, internal),
      uploadMethod: 'PUT',
      requestHeaders: {
        'Content-Type': contentType,
        'Content-Length': contentLength,
      },
    };
  }

  async validateToken(token: string, file: ILocalFileUpload) {
    const validateMeta = await this.cacheService.get(`attachment:local-signature:${token}`);
    if (!validateMeta) {
      throw new CustomHttpException('Invalid token', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidToken',
        },
      });
    }
    const { expiresDate, contentLength, contentType } = validateMeta;

    const { size, mimetype } = file;
    if (Math.floor(Date.now() / 1000) > expiresDate) {
      throw new CustomHttpException('Token has expired', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.tokenExpired',
        },
      });
    }
    // 0 is a size too: skipping the check for it let a zero-length signature
    // carry a body of any size.
    if (typeof contentLength === 'number' && contentLength !== size) {
      throw new CustomHttpException('Size mismatch', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.sizeMismatch',
        },
      });
    }
    if (mimetype && !isBodyParserFallback(mimetype, contentType) && mimetype !== contentType) {
      throw new CustomHttpException(
        `Not allow upload ${mimetype} file`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.attachment.notAllowUploadFileType',
            context: {
              mimetype,
            },
          },
        }
      );
    }
  }

  private fileSizeExceeded(maxFileSize: number): CustomHttpException {
    const maxSize = (maxFileSize / (1024 * 1024)).toFixed(2);
    return new CustomHttpException(
      `File size exceeds the maximum limit of ${maxSize} MB`,
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.attachment.fileSizeExceedsMaximumLimit',
          context: { maxSize: `${maxSize}MB` },
        },
      }
    );
  }

  /**
   * Remove a temp file left behind by {@link saveTemporaryFile} when the upload is
   * rejected after its body was already streamed to disk (e.g. a size/type/token
   * failure in validateToken). Without this, rejected uploads accumulate in the
   * temporary dir and can exhaust disk.
   */
  removeTemporaryFile(path: string) {
    this.deleteLocalFile(path);
  }

  async saveTemporaryFile(req: Request, maxSize?: number) {
    const name = getRandomString(12);
    const path = resolve(StorageAdapter.TEMPORARY_DIR, name);
    let size = 0;
    return new Promise<ILocalFileUpload>((resolve, reject) => {
      const fileStream = createWriteStream(path);
      let settled = false;
      // Drop the half-written temp file on any failure so a rejected upload never
      // lingers in the temporary dir.
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        fileStream.destroy();
        this.deleteLocalFile(path);
        reject(err);
      };
      try {
        req.on('data', (chunk) => {
          if (settled) return;
          size += chunk.length;
          // Hard cap enforced on the bytes actually streamed, independent of the
          // client-declared Content-Length: a signature minted with contentLength 0
          // (or any under-declared value) must not let the body exceed the configured
          // limit or write an unbounded file to disk.
          if (maxSize !== undefined && size > maxSize) {
            req.destroy();
            fail(this.fileSizeExceeded(maxSize));
            return;
          }
          fileStream.write(chunk);
        });

        req.on('end', () => {
          if (!settled) fileStream.end();
        });
        req.on('error', (err) => {
          fail(err);
        });

        fileStream.on('error', (err) => {
          fail(err);
        });

        fileStream.on('finish', () => {
          if (settled) return;
          settled = true;
          resolve({
            size,
            mimetype: req.headers['content-type'] as string,
            path,
          });
        });
      } catch (error) {
        this.logger.error('saveTemporaryFile error', error);
        fail(error);
      }
    });
  }

  async save(filePath: string, rename: string, isDelete: boolean = true) {
    const newFilePath = resolveWithinStorage(this.storageDir, rename);
    await fse.copy(filePath, newFilePath);
    if (isDelete) {
      this.deleteLocalFile(filePath);
    }
    return join(this.path, rename);
  }

  read(path: string) {
    return createReadStream(resolveWithinStorage(this.storageDir, path));
  }

  getLastModifiedTime(path: string) {
    const url = resolveWithinStorage(this.storageDir, path);
    if (!fse.existsSync(url)) {
      return;
    }
    return fse.statSync(url).mtimeMs;
  }

  async getFileMate(path: string) {
    try {
      const info = await sharp(path).metadata();
      return normalizeImageDimensions(info);
    } catch {
      return {};
    }
  }

  async getObjectMeta(bucket: string, path: string, token: string): Promise<IObjectMeta> {
    const uploadCache = await this.cacheService.get(`attachment:upload:${token}`);
    if (!uploadCache) {
      throw new CustomHttpException('Invalid token', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidToken',
        },
      });
    }
    const { mimetype, hash, size } = uploadCache;

    const meta = {
      hash,
      mimetype,
      size,
      url: this.getUrl(bucket, path, {
        respHeaders: forceAttachmentDisposition({ 'Content-Type': mimetype }),
        expiresDate: -1,
      }),
    };

    if (!isImage(mimetype ?? '')) {
      return meta;
    }
    return {
      ...meta,
      ...(await this.getFileMate(resolveWithinStorage(this.storageDir, bucket, path))),
    };
  }

  async getPreviewUrl(
    bucket: string,
    path: string,
    expiresIn: number = second(this.config.urlExpireIn),
    respHeaders?: IRespHeaders
  ): Promise<string> {
    const url = this.getUrl(bucket, path, {
      expiresDate: Math.floor(Date.now() / 1000) + expiresIn,
      respHeaders,
    });
    const origin = this.cls.get('origin');
    const prefix = origin?.byApi ? this.baseConfig.storagePrefix : '';
    return prefix + join('/', url);
  }

  /**
   * Verifies a read token against the `bucket/path` actually requested. A
   * token only ever opens the object it was minted for; tokens without the
   * path claim (the pre-binding shape) are rejected outright rather than
   * grandfathered, since they were replayable across every private object.
   */
  verifyReadToken(token: string, path: string) {
    const invalidToken = () =>
      new CustomHttpException('Invalid token', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidToken',
        },
      });
    let payload: ReturnType<LocalReadTokenCodec['decode']>;
    try {
      payload = this.readTokenCodec.decode(token);
    } catch (error) {
      throw invalidToken();
    }
    const { expiresDate, respHeaders } = payload;
    if (
      typeof payload.path !== 'string' ||
      normalizeObjectPath(payload.path) !== normalizeObjectPath(path)
    ) {
      throw invalidToken();
    }
    if (expiresDate > 0 && Math.floor(Date.now() / 1000) > expiresDate) {
      throw new CustomHttpException('Token has expired', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.tokenExpired',
        },
      });
    }
    return { respHeaders };
  }

  async uploadFileWidthPath(
    bucket: string,
    path: string,
    filePath: string,
    _metadata: Record<string, unknown>
  ) {
    const hash = await FileUtils.getHash(filePath);
    await this.save(filePath, join(bucket, path), false);
    return {
      hash,
      path,
    };
  }

  async uploadFile(
    bucket: string,
    path: string,
    stream: Buffer | ReadableStream,
    _metadata?: Record<string, unknown>
  ) {
    const name = getRandomString(12);
    const temPath = resolve(StorageAdapter.TEMPORARY_DIR, name);
    if (Buffer.isBuffer(stream)) {
      await fse.writeFile(temPath, stream);
    } else {
      const writer = createWriteStream(temPath);
      await new Promise<void>((resolve, reject) => {
        stream.pipe(writer);
        stream.on('error', reject);
        writer.on('finish', resolve);
        writer.on('error', reject);
      }).catch((err) => {
        this.deleteLocalFile(temPath);
        throw err;
      });
    }
    const hash = await FileUtils.getHash(temPath);
    await this.save(temPath, join(bucket, path));
    return {
      hash,
      path,
    };
  }

  async uploadFileStream(
    bucket: string,
    path: string,
    stream: Buffer | ReadableStream,
    _metadata?: Record<string, unknown>,
    signal?: AbortSignal
  ) {
    if (!signal) {
      return await this.uploadFile(bucket, path, stream, _metadata);
    }
    signal.throwIfAborted();
    const destinationPath = resolveWithinStorage(this.storageDir, bucket, path);
    const destinationDirectory = dirname(destinationPath);
    await fsp.mkdir(destinationDirectory, { recursive: true });
    signal.throwIfAborted();
    const stagingDirectory = await fsp.mkdtemp(join(destinationDirectory, '.upload-'));
    const stagingPath = join(stagingDirectory, 'content');
    LocalStorage.activeUploads.add(stagingDirectory);
    let stagingHandle: FileHandle | undefined;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let heartbeat: Promise<void> | undefined;
    let heartbeatError: unknown;
    const hash = createHash('sha256');
    try {
      stagingHandle = await fsp.open(stagingDirectory, 'r');
      const handle = stagingHandle;
      heartbeatTimer = setInterval(() => {
        if (heartbeat) return;
        const now = new Date();
        // Refresh the opened inode, never a replacement at the same path.
        heartbeat = handle
          .utimes(now, now)
          .catch((error: unknown) => {
            heartbeatError = error;
          })
          .finally(() => {
            heartbeat = undefined;
          });
      }, UPLOAD_STAGING_HEARTBEAT_MS);
      heartbeatTimer.unref();
      signal.throwIfAborted();
      if (Buffer.isBuffer(stream)) {
        hash.update(stream);
        await fsp.writeFile(stagingPath, stream, { signal });
      } else {
        await pipeline(
          stream,
          async function* (chunks) {
            for await (const chunk of chunks) {
              hash.update(chunk);
              yield chunk;
            }
          },
          createWriteStream(stagingPath),
          { signal }
        );
      }
      signal.throwIfAborted();
      const digest = hash.digest('hex');
      if (heartbeatError) throw heartbeatError;
      const currentDirectory = await fsp.lstat(stagingDirectory);
      const ownedDirectory = await stagingHandle.stat();
      if (
        !currentDirectory.isDirectory() ||
        currentDirectory.dev !== ownedDirectory.dev ||
        currentDirectory.ino !== ownedDirectory.ino
      ) {
        throw new Error('Local upload staging directory changed before publication');
      }
      signal.throwIfAborted();
      // Rename is the publication point. Once issued, a completed replacement
      // remains successful even if cancellation arrives while rename is pending.
      await fsp.rename(stagingPath, destinationPath);
      return { hash: digest, path };
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeat;
      try {
        const currentDirectory = await fsp.lstat(stagingDirectory);
        const ownedDirectory = await stagingHandle?.stat();
        if (
          currentDirectory.isDirectory() &&
          ownedDirectory &&
          currentDirectory.dev === ownedDirectory.dev &&
          currentDirectory.ino === ownedDirectory.ino
        ) {
          await fsp.rm(stagingDirectory, { recursive: true, force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      } finally {
        LocalStorage.activeUploads.delete(stagingDirectory);
        await stagingHandle?.close();
      }
    }
  }

  async cropImage(
    bucket: string,
    path: string,
    width?: number,
    height?: number,
    _newPath?: string
  ) {
    const newPath = _newPath || `${path}_${width ?? 0}_${height ?? 0}`;
    const resizedImagePath = resolveWithinStorage(this.storageDir, bucket, newPath);
    if (fse.existsSync(resizedImagePath)) {
      return newPath;
    }

    const imagePath = resolveWithinStorage(this.storageDir, bucket, path);
    const image = sharp(imagePath, { failOn: 'none', unlimited: true }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new CustomHttpException('Invalid image', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidImage',
        },
      });
    }
    const resizedImage = image
      .resize(getThumbnailResizeOptions(width, height))
      .webp({ quality: ATTACHMENT_THUMBNAIL_WEBP_QUALITY });
    const tmpPath = `${resizedImagePath}_tmp_${getRandomString(8)}`;
    try {
      await resizedImage.toFile(tmpPath);
      await fse.move(tmpPath, resizedImagePath, { overwrite: true });
    } finally {
      await fse.remove(tmpPath);
    }
    return newPath;
  }

  async downloadFile(bucket: string, path: string): Promise<ReadableStream> {
    const filePath = resolveWithinStorage(this.storageDir, bucket, path);
    // reject up front with the fs error (ENOENT) instead of returning a stream that errors
    await fsp.access(filePath);
    return createReadStream(filePath);
  }

  /** Reclaim crash leftovers through the existing hourly export cleanup job. */
  async cleanupStaleExportUploads(now = new Date()): Promise<{ deleted: number; failed: number }> {
    const result = { deleted: 0, failed: 0 };
    const bucket = StorageAdapter.getBucket(UploadType.ExportBase);
    const prefix = StorageAdapter.getDir(UploadType.ExportBase);
    const directory = resolveWithinStorage(this.storageDir, bucket, prefix);
    try {
      const storageRoot = await fsp.realpath(this.storageDir);
      // Neither the bucket nor export-base may redirect cleanup through a symlink.
      if ((await fsp.realpath(directory)) !== resolveWithinStorage(storageRoot, bucket, prefix)) {
        return result;
      }
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !UPLOAD_STAGING_DIRECTORY.test(entry.name)) continue;
        const stagingDirectory = join(directory, entry.name);
        if (LocalStorage.activeUploads.has(stagingDirectory)) continue;
        try {
          const children = await fsp.readdir(stagingDirectory, { withFileTypes: true });
          // This exact layout is owned by uploadFileStream. Unknown content and
          // links are left alone, even when their names resemble our staging dirs.
          if (children.some((child) => child.name !== 'content' || !child.isFile())) continue;
          const staged = await fsp.lstat(stagingDirectory);
          if (!staged.isDirectory()) continue;
          const content = children.length
            ? await fsp.lstat(join(stagingDirectory, 'content'))
            : undefined;
          if (content && !content.isFile()) continue;
          const lastActivity = Math.max(staged.mtimeMs, content?.mtimeMs ?? 0);
          if (now.getTime() <= lastActivity + UPLOAD_STAGING_STALE_MS) continue;
          const current = await fsp.lstat(stagingDirectory);
          if (
            !current.isDirectory() ||
            current.dev !== staged.dev ||
            current.ino !== staged.ino ||
            now.getTime() <= current.mtimeMs + UPLOAD_STAGING_STALE_MS
          ) {
            continue;
          }
          // rm does not follow links. Published objects live outside this exact
          // directory and retain their ordinary signed-link lifetime.
          await fsp.rm(stagingDirectory, { recursive: true, force: true });
          result.deleted++;
        } catch (error) {
          // Another cleanup worker or the uploader may have removed it first.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          result.failed++;
          this.logger.warn(`Failed to delete stale upload ${entry.name}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return result;
  }

  async listObjects(
    bucket: string,
    prefix: string,
    options?: IListObjectsOptions
  ): Promise<IListObjectsResult> {
    // keys first, stat only the page: a paged walk does not stat every file each time
    const files: { key: string; path: string }[] = [];
    const prefixes = new Set<string>();
    const bucketDir = resolve(this.storageDir, bucket);
    // emulate S3 prefix semantics on the filesystem: prefix is a key prefix, keys use '/'
    const isRelevant = (key: string) =>
      key.startsWith(prefix) || prefix.startsWith(`${key}/`) || prefix.startsWith(key);
    const walk = (dir: string, keyPrefix: string) => {
      if (!existsSync(dir)) return;
      for (const entry of fse.readdirSync(dir, { withFileTypes: true })) {
        const key = keyPrefix ? `${keyPrefix}/${entry.name}` : entry.name;
        if (!isRelevant(key)) continue;
        if (entry.isFile() && key.startsWith(prefix)) {
          files.push({ key, path: join(dir, entry.name) });
          continue;
        }
        if (!entry.isDirectory()) continue;
        // Staging bytes are never published objects and must not inherit the
        // legacy object TTL (or be exposed to any other object-list consumer).
        if (UPLOAD_STAGING_DIRECTORY.test(entry.name)) continue;
        if (options?.delimiter && key.startsWith(prefix)) {
          prefixes.add(`${key}${options.delimiter}`);
          continue;
        }
        walk(join(dir, entry.name), key);
      }
    };
    walk(bucketDir, '');
    files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const objects = pageOf(files, options).map(({ key, path }) => {
      const { size, mtime } = fse.statSync(path);
      return { key, size, lastModified: mtime };
    });
    return {
      objects,
      prefixes: [...prefixes].sort((a, b) => Number(a > b) - Number(a < b)),
    };
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const filePath = resolveWithinStorage(this.storageDir, bucket, path);
    this.deleteLocalFile(filePath);
  }

  async deleteDir(bucket: string, path: string, throwError: boolean = true) {
    const dirPath = resolveWithinStorage(this.storageDir, bucket, path);
    try {
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true });
      } else {
        this.logger.error('delete dir failed: no such dir', dirPath);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error?.code === 'ENOENT' || !throwError) {
        return;
      }
      throw error;
    }
  }
}
