import fs from 'fs';
import type { FileNode } from './interface';
import { TeableFile } from './teable-file';

export class FileTree {
  constructor(public rootPath: string) {
    this.rootPath = rootPath;
  }

  public getFileContent(path: string) {
    if (fs.existsSync(path) && fs.lstatSync(path).isDirectory()) {
      throw Error('not a file');
    }
    const fileContext = fs.readFileSync(path).toString();
    return {
      content: fileContext,
      path,
    };
  }

  transformTeableFileIntoTree(path: string, name: string) {
    const teableFileHandler = new TeableFile();
    return {
      name,
      path,
      children: teableFileHandler.getTeableFileTree(path),
      type: 'teable',
      isDirectory: false,
    };
  }

  getFiles(): FileNode {
    return this.getFilesRecursive(this.rootPath);
  }

  getTreeByFilePath(path: string, name: string) {
    if (path.endsWith('.teable')) {
      return this.transformTeableFileIntoTree(path, name);
    }
    return {
      name,
      path,
      children: [],
      type: 'file',
      isDirectory: false,
    };
  }

  getTreeByDirPath(path: string) {
    const files: FileNode[] = [];
    const name = path.split('/').reverse()[0];
    const dir = fs.readdirSync(path, { withFileTypes: true });
    for (const dirent of dir) {
      const fullPath = path + '/' + dirent.name;
      if (dirent.name.startsWith('.')) {
        continue;
      }
      if (dirent.isDirectory()) {
        const children = this.getFilesRecursive(path + '/' + dirent.name);
        files.push(children);
      } else if (dirent.name.endsWith('.teable')) {
        const children = this.transformTeableFileIntoTree(
          fullPath,
          dirent.name
        );
        files.push(children);
      } else {
        files.push({
          name: dirent.name,
          path: fullPath,
          type: 'file',
          isDirectory: false,
        });
      }
    }
    return {
      name,
      path,
      children: files,
      isDirectory: true,
      type: 'directory',
    };
  }

  getFilesRecursive(path: string): FileNode {
    const name = path.split('/').reverse()[0];
    if (fs.lstatSync(path).isDirectory()) {
      return this.getTreeByDirPath(path);
    } else {
      return this.getTreeByFilePath(path, name);
    }
  }
}
