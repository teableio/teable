/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import fs from 'fs';
import type { IncomingHttpHeaders } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { IAttachmentItem } from '@teable/core';
import { generateAttachmentId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  axios,
  UploadType,
  type INotifyVo,
  type SignatureRo,
  type SignatureVo,
} from '@teable/openapi';
import type { Request, Response } from 'express';
import fse from 'fs-extra';
import mimeTypes from 'mime-types';
import { nanoid } from 'nanoid';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { StorageConfig, IStorageConfig } from '../../configs/storage';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import type { IClsStore } from '../../types/cls';
import { FileUtils } from '../../utils';
import { second } from '../../utils/second';
import { AttachmentsCropQueueProcessor } from './attachments-crop.processor';
import { AttachmentsStorageService } from './attachments-storage.service';
import StorageAdapter from './plugins/adapter';
import type { LocalStorage } from './plugins/local';
import { InjectStorageAdapter } from './plugins/storage';
@Injectable()
export class AttachmentsService {
  private logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    private readonly attachmentsCropQueueProcessor: AttachmentsCropQueueProcessor,
    @StorageConfig() readonly storageConfig: IStorageConfig,
    @ThresholdConfig() readonly thresholdConfig: IThresholdConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter
  ) {}
  /**
   * Local upload
   */
  async upload(req: Request, token: string) {
    const tokenCache = await this.cacheService.get(`attachment:signature:${token}`);
    const localStorage = this.storageAdapter as LocalStorage;
    if (!tokenCache) {
      throw new BadRequestException(`Invalid token: ${token}`);
    }
    const { path, bucket } = tokenCache;
    const file = await localStorage.saveTemporaryFile(req);
    await localStorage.validateToken(token, file);
    const hash = await FileUtils.getHash(file.path);
    await localStorage.save(file.path, join(bucket, path));

    await this.cacheService.set(
      `attachment:upload:${token}`,
      { mimetype: file.mimetype, hash, size: file.size },
      second(this.storageConfig.tokenExpireIn)
    );
  }

  async readLocalFile(path: string, token?: string) {
    const localStorage = this.storageAdapter as LocalStorage;
    let respHeaders: Record<string, string> = {};

    if (!path) {
      throw new HttpException(`Could not find attachment: ${token}`, HttpStatus.NOT_FOUND);
    }
    const { bucket, token: tokenInPath } = localStorage.parsePath(path);
    if (token && !StorageAdapter.isPublicBucket(bucket)) {
      respHeaders = localStorage.verifyReadToken(token).respHeaders ?? {};
    } else {
      const attachment = await this.prismaService
        .txClient()
        .attachments.findUnique({ where: { token: tokenInPath, deletedTime: null } });
      if (!attachment) {
        throw new BadRequestException(`Invalid path: ${path}`);
      }
      respHeaders['Content-Type'] = attachment.mimetype;
    }

    const headers: Record<string, string> = respHeaders ?? {};
    const fileStream = localStorage.read(path);

    return { headers, fileStream };
  }

  localFileConditionalCaching(path: string, reqHeaders: IncomingHttpHeaders, res: Response) {
    const ifModifiedSince = reqHeaders['if-modified-since'];
    const localStorage = this.storageAdapter as LocalStorage;
    const lastModifiedTimestamp = localStorage.getLastModifiedTime(path);
    if (!lastModifiedTimestamp) {
      throw new BadRequestException(`Could not find attachment: ${path}`);
    }
    // Comparison of accuracy in seconds
    if (
      !ifModifiedSince ||
      Math.floor(new Date(ifModifiedSince).getTime() / 1000) <
        Math.floor(lastModifiedTimestamp / 1000)
    ) {
      res.set('Last-Modified', new Date(lastModifiedTimestamp).toUTCString());
      return false;
    }
    return true;
  }

  async signature(signatureRo: SignatureRo & { internal?: boolean }): Promise<SignatureVo> {
    const { type, ...presignedParams } = signatureRo;
    const contentLength = signatureRo.contentLength;
    const MAX_FILE_SIZE = this.thresholdConfig.maxAttachmentUploadSize;
    if (contentLength > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds the maximum limit of ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(2)} MB`
      );
    }
    const hash = presignedParams.hash;
    const dir = StorageAdapter.getDir(type);
    const bucket = StorageAdapter.getBucket(type);
    const res = await this.storageAdapter.presigned(bucket, dir, {
      ...presignedParams,
    });
    const { path, token } = res;
    await this.cacheService.set(
      `attachment:signature:${token}`,
      { path, bucket, hash },
      signatureRo.expiresIn ?? second(this.storageConfig.tokenExpireIn)
    );
    return res;
  }

  async notify(token: string, filename?: string): Promise<INotifyVo> {
    const tokenCache = await this.cacheService.get(`attachment:signature:${token}`);
    if (!tokenCache) {
      throw new BadRequestException(`Invalid token: ${token}`);
    }
    const userId = this.cls.get('user.id');
    const { path, bucket } = tokenCache;
    const { hash, size, mimetype, width, height, url } = await this.storageAdapter.getObjectMeta(
      bucket,
      path,
      token
    );
    const attachment = await this.prismaService.txClient().attachments.create({
      data: {
        hash,
        size,
        mimetype,
        token,
        path,
        width,
        height,
        createdBy: userId,
      },
      select: {
        token: true,
        size: true,
        mimetype: true,
        width: true,
        height: true,
        path: true,
      },
    });
    await this.attachmentsCropQueueProcessor.queue.add('attachment_crop_image', {
      token: attachment.token,
      path: attachment.path,
      mimetype: attachment.mimetype,
      height: attachment.height,
      bucket,
    });
    const filenameHeader = filename
      ? {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        }
      : {};
    return {
      ...attachment,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      url,
      presignedUrl: await this.attachmentsStorageService.getPreviewUrlByPath(
        bucket,
        path,
        token,
        undefined,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        { 'Content-Type': mimetype, ...filenameHeader }
      ),
    };
  }

  private async notifyToAttachmentItem(token: string, filename: string): Promise<IAttachmentItem> {
    const notifyVo = await this.notify(token, filename);
    return {
      ...notifyVo,
      id: generateAttachmentId(),
      name: filename,
    };
  }

  async uploadFile(file: Express.Multer.File): Promise<IAttachmentItem> {
    const MAX_FILE_SIZE = this.thresholdConfig.maxOpenapiAttachmentUploadSize;
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds the maximum limit of ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(2)} MB`
      );
    }

    const contentType =
      file.mimetype === 'application/octet-stream'
        ? mimeTypes.lookup(file.originalname) || file.mimetype
        : file.mimetype;
    const contentLength = file.size;

    const { token, url } = await this.signature({
      type: UploadType.Table,
      contentLength,
      contentType,
      internal: true,
    });
    const fileStream = Readable.from(file.buffer);

    this.logger.log(
      `Uploading file: ${file.originalname}, size: ${contentLength} bytes, mimetype: ${contentType}`
    );

    await this.uploadStreamToStorage(url, fileStream, contentType, contentLength);

    return await this.notifyToAttachmentItem(token, file.originalname);
  }

  async uploadFromUrl(fileUrl: string): Promise<IAttachmentItem> {
    const MAX_FILE_SIZE = this.thresholdConfig.maxOpenapiAttachmentUploadSize;

    const { contentLength, contentType, tempFilePath } = await this.getFileInfo(
      fileUrl,
      MAX_FILE_SIZE
    );

    if (contentLength > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File size exceeds the maximum limit of ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(2)} MB`
      );
    }

    const filename = this.getFilenameFromUrl(fileUrl);
    const { token, url } = await this.signature({
      type: UploadType.Table,
      contentLength,
      contentType,
      internal: true,
    });

    try {
      await this.uploadFileContent(url, tempFilePath, contentType, contentLength, fileUrl);
      return await this.notifyToAttachmentItem(token, filename);
    } catch (error) {
      console.error('uploadFromUrl:upload', error);
      throw new BadRequestException('Url reject');
    } finally {
      if (tempFilePath) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  private async getFileInfo(
    fileUrl: string,
    maxFileSize: number
  ): Promise<{ contentLength: number; contentType: string; tempFilePath: string | null }> {
    let contentLength: number | undefined;
    let contentType: string | undefined;
    let tempFilePath: string | null = null;

    try {
      const headResponse = await axios.head(fileUrl);
      contentLength =
        headResponse.headers['content-length'] && parseInt(headResponse.headers['content-length']);
      contentType = headResponse.headers['content-type'];
      this.logger.log(
        `HEAD request successful. Content-Length: ${contentLength}, Content-Type: ${contentType}`
      );
    } catch (error) {
      console.warn('HEAD request failed, falling back to GET:', error);
    }

    if (!contentLength) {
      this.logger.log('Content length not available from HEAD request. Downloading file...');
      const tempFileName = `temp-${nanoid()}`;
      tempFilePath = join(tmpdir(), tempFileName);

      await this.downloadFile(fileUrl, tempFilePath, maxFileSize);
      contentLength = fs.statSync(tempFilePath).size;
      this.logger.log(`File downloaded. Size: ${contentLength} bytes`);

      if (!contentType) {
        contentType = mimeTypes.lookup(fileUrl) || 'application/octet-stream';
      }
    }

    return {
      contentLength,
      contentType: contentType as string,
      tempFilePath,
    };
  }

  private async uploadFileContent(
    url: string,
    tempFilePath: string | null,
    contentType: string,
    contentLength: number,
    fileUrl: string
  ): Promise<void> {
    if (tempFilePath) {
      await this.uploadStreamToStorage(
        url,
        fs.createReadStream(tempFilePath),
        contentType,
        contentLength
      );
      this.logger.log('Upload from temporary file completed');
    } else {
      this.logger.log(`Downloading and uploading from URL: ${fileUrl}`);
      const response = await axios.get(fileUrl, { responseType: 'stream' });
      await this.uploadStreamToStorage(url, response.data, contentType, contentLength);
    }
  }

  private async uploadStreamToStorage(
    url: string,
    stream: Readable,
    contentType: string,
    contentLength: number
  ): Promise<void> {
    try {
      await axios.put(url, stream, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': contentLength,
        },
      });
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }

  private getFilenameFromUrl(url: string): string {
    const urlParts = new URL(url);
    const pathParts = urlParts.pathname.split('/');
    return pathParts[pathParts.length - 1] || 'downloaded_file';
  }

  private async downloadFile(url: string, filePath: string, maxSize: number): Promise<void> {
    let downloadedBytes = 0;

    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
    });

    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      const cleanup = () => {
        writer.removeAllListeners();
        writer.destroy();
        response.data?.removeAllListeners();
        response.data?.destroy?.();
        fse.removeSync(filePath);
      };
      try {
        response.data.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (downloadedBytes > maxSize) {
            cleanup();
            throw new BadRequestException(
              `File size exceeds the maximum limit of ${maxSize / (1024 * 1024)} MB`
            );
          }
        });

        response.data.on('error', (error: unknown) => {
          cleanup();
          reject(error);
        });

        response.data.pipe(writer);

        writer.on('finish', resolve);
        writer.on('error', (error: unknown) => {
          cleanup();
          reject(error);
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
}
