import fs from 'fs';
import type { FileNode } from './interface';

//  TODO: need complete teable file structure
interface ITeableFile {
  title: string;
  teableList: string[];
}

export class TeableFile {
  static format = '.teable';

  public getTeableFileTree(path: string) {
    const content = this.getFileContent2JSON(path);
    return this.getFileTree(content, path);
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

  private getFileTree(
    teableFileContent: ITeableFile,
    parentPath: string
  ): FileNode[] {
    return teableFileContent.teableList.map((teableName) => {
      return {
        name: teableName,
        path: parentPath + '#' + teableName,
        children: [],
        type: 'table',
        isDirectory: false,
      };
    });
  }
}
