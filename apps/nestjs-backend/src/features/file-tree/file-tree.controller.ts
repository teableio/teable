import { parse } from 'url';
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';
import { FileTree } from './file-tree.class';

@Controller('api')
export class FileTreeController {
  @Get('file-tree/*')
  getFileTree(@Req() req: Request) {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;
    const filePath = pathname?.split('/api/file-tree')[1];
    if (!filePath) {
      return {
        success: false,
        errors: ['no path'],
      };
    }
    const fileTree = new FileTree(filePath);
    return JSON.stringify(fileTree.getFiles());
  }

  @Get('teable/schema/:tableId')
  getTableMeta() {
    return {
      success: true,
      data: {},
    };
  }

  @Get('file-content/*')
  getFileContent(@Req() req: Request) {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;
    const filePath = pathname?.split('/api/file-content')[1];
    if (!filePath) {
      return {
        success: false,
        errors: ['no path'],
      };
    }
    const fileTree = new FileTree(filePath);
    return {
      success: true,
      data: fileTree.getFileContent(filePath),
    };
  }
}
