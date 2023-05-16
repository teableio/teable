import { createHash } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createReadStream } from 'fs-extra';
import mime from 'mime-types';
import { PrismaService } from '../../prisma.service';
import type { AttachmentUploadRo } from './modal/attachment-upload.ro';
import { Storage } from './plugins/storage';

@Injectable()
export class AttachmentsService {
  constructor(private readonly prismaService: PrismaService) {}
  /**
   * Local upload
   */
  async upload(file: Express.Multer.File): Promise<AttachmentUploadRo> {
    const token = await this.fileToken(file.path);
    const localStorage = Storage.adapter();
    const path = await localStorage.save(file, token);
    const { size, mimetype } = file;
    const data = {
      size,
      mimetype,
      token,
      path,
    };
    await this.prismaService.attachments.create({ data });
    return data;
  }

  async readLocalFile(token: string, filename?: string) {
    const attachment = await this.prismaService.attachments.findFirst({
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
    const fileStream = localStorage.read(token);
    return { headers, fileStream };
  }

  async fileToken(path: string): Promise<string> {
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

  getUploadUrl() {
    const localStorage = Storage.adapter();
    return localStorage.getUploadUrl();
  }
}
