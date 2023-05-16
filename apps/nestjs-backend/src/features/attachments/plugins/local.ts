import { createReadStream } from 'fs';
import { resolve } from 'path';
import * as fse from 'fs-extra';
import type StorageAdapter from './storage';

export default class Local implements StorageAdapter {
  path = 'uploads';
  storageDir = resolve(process.cwd(), '.assets', this.path);

  getUploadUrl() {
    return '/api/attachments/upload';
  }

  async save(file: Express.Multer.File, rename: string) {
    const distPath = resolve(this.storageDir);
    const newFilePath = resolve(distPath, rename);
    fse.ensureDir(distPath);
    await fse.copy(file.path, newFilePath);
    await fse.unlink(file.path);
    return this.path;
  }

  read(path: string) {
    return createReadStream(resolve(this.storageDir, path));
  }
}
