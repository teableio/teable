import fs from 'node:fs';
import type { FileNode } from './interface';

//  TODO: need complete teable file structure
interface ITeableFile {
  title: string;
  meta: {
    teableList: string[];
  };
}

export class TeableFile {
  static format = '.teable';

  public getTeableFileTree(path: string) {
    const content = this.getFileContent2JSON(path);
    return this.getFileTree(content);
  }
  private getFileContent2JSON(path: string) {
    if (!path.endsWith(TeableFile.format)) {
      throw new Error('file format error');
    }
    const fileContent = fs.readFileSync(path).toString();
    try {
      return JSON.parse(fileContent);
    } catch (error) {
      throw new Error('file content is not a valid json');
    }
  }

  private getFileTree(teableFileContext: ITeableFile): FileNode[] {
    return teableFileContext.meta.teableList.map((teableName) => {
      return {
        name: teableName,
        path: teableName,
        children: [],
        type: 'teable',
        isDirectory: false,
      };
    });
  }
}
