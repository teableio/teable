import { createHash } from 'crypto';
import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { getRandomString } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import type { SignatureVo } from '@teable-group/openapi';
import { createReadStream } from 'fs-extra';
import mime from 'mime-types';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { getFullStorageUrl } from '../../utils/full-storage-url';
import { Storage } from './plugins/storage';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}
  /**
   * Local upload
   */
  async upload(file: Express.Multer.File, token: string) {
    const hash = await this.fileHash(file.path);
    const localStorage = Storage.adapter();

    const path = await localStorage.save(file, hash);
    const { size, mimetype } = file;
    const data: Prisma.AttachmentsCreateInput = {
      hash,
      size,
      mimetype,
      token,
      path,
      url: localStorage.getUrl(token),
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    if (file.mimetype.startsWith('image/')) {
      const { width, height } = await localStorage.getImageWidthAndHeight(path);
      data.width = width;
      data.height = height;
    }

    const count = await this.prismaService.attachments.count({
      where: { token },
    });

    if (count === 0) {
      await this.prismaService.attachments.create({ data });
    }
  }

  async readLocalFile(token: string, filename?: string) {
    const attachment = await this.prismaService.attachments.findFirst({
      select: {
        mimetype: true,
        hash: true,
      },
      where: {
        token,
        deletedTime: null,
      },
    });
    if (!attachment) {
      throw new HttpException(`Could not find attachment: ${token}`, HttpStatus.NOT_FOUND);
    }
    const headers: Record<string, string> = {};
    const contentType = mime.contentType(attachment.mimetype);
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    if (filename) {
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }

    const localStorage = Storage.adapter();
    const fileStream = localStorage.read(attachment.hash);
    return { headers, fileStream };
  }

  async fileHash(path: string): Promise<string> {
    const hash = createHash('sha256');
    const fileReadStream = createReadStream(path);
    fileReadStream.on('data', (data) => {
      hash.update(data);
    });
    return new Promise((resolve) => {
      fileReadStream.on('end', () => {
        resolve(hash.digest('hex'));
      });
    });
  }

  async signature(): Promise<SignatureVo> {
    const localStorage = Storage.adapter();
    const token = getRandomString(12);
    return {
      url: `${localStorage.getUploadUrl()}/${token}`,
      secret: token,
    };
  }

  async notify(token: string) {
    const attachment = await this.prismaService.attachments.findFirst({
      select: {
        token: true,
        size: true,
        mimetype: true,
        width: true,
        height: true,
        url: true,
      },
      where: {
        token,
        deletedTime: null,
      },
    });
    if (!attachment) {
      throw new NotFoundException(`Could not find attachment: ${token}`);
    }
    return {
      ...attachment,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
      url: getFullStorageUrl(attachment.url),
    };
  }
}
