import fs from 'node:fs';
import type { FileNode } from './interface';
import { TeableFile } from './teable-file';

export class FileTree {
  constructor(public rootPath: string) {
    this.rootPath = rootPath;
  }
  getFiles(): FileNode[] {
    return this.getFilesRecursive(this.rootPath);
  }
  getFilesRecursive(path: string): FileNode[] {
    const files: FileNode[] = [];
    const dir = fs.readdirSync(path, { withFileTypes: true });
    for (const dirent of dir) {
      const fullPath = path + '/' + dirent.name;
      if (dirent.isDirectory()) {
        const children = this.getFilesRecursive(path + '/' + dirent.name);
        files.push({
          name: dirent.name,
          path: fullPath,
          children,
          type: 'directory',
          isDirectory: true,
        });
      } else if (dirent.name.endsWith('.teable')) {
        const teableFileHandler = new TeableFile();

        files.push({
          name: dirent.name,
          path: fullPath,
          children: teableFileHandler.getTeableFileTree(fullPath),
          type: 'file',
          isDirectory: false,
        });
      } else {
        files.push({
          name: dirent.name,
          path: fullPath,
          type: 'file',
          isDirectory: false,
        });
      }
    }
    return files;
  }
}
