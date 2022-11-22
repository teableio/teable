// fixme: disable eslint for nest src
import { parse } from 'url';
import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { FileTree } from './teable/file-tree';

@Controller('/api')
export class AppController {
  @Get('spaces')
  getSpaces() {
    return JSON.stringify({ hello: 'world' });
  }

  @Get('/fileTree/*')
  getFileTree(@Req() req: Request) {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;
    const filePath = pathname?.split('/api/fileTree/')[1];
    const fileTree = new FileTree(filePath!);
    return JSON.stringify(fileTree.getFiles());
  }

  @Get('/fileContent/*')
  getFileContent(@Req() req: Request) {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;
    const filePath = pathname?.split('/api/fileContent/')[1];
    if (!filePath) {
      return {
        success: false,
        errors: ['no path'],
      };
    }
    const fileTree = new FileTree(filePath);
    return {
      success: true,
      data: fileTree.getFileContext(filePath),
    };
  }
}
