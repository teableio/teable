import { createReadStream } from 'fs';
import { resolve, join } from 'path';
import * as fse from 'fs-extra';
import sharp from 'sharp';
import type StorageAdapter from './storage';

export default class Local implements StorageAdapter {
  path = '.assets/uploads';
  storageDir = resolve(process.cwd(), this.path);

  getUploadUrl() {
    return '/api/attachments/upload';
  }

  async save(file: Express.Multer.File, rename: string) {
    const distPath = resolve(this.storageDir);
    const newFilePath = resolve(distPath, rename);
    fse.ensureDir(distPath);
    await fse.copy(file.path, newFilePath);
    await fse.unlink(file.path);
    return join(this.path, rename);
  }

  read(path: string) {
    return createReadStream(resolve(this.storageDir, path));
  }

  async getImageWidthAndHeight(path: string) {
    const info = await sharp(path).metadata();
    return {
      width: info.width,
      height: info.height,
    };
  }
}
