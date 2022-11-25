// fixme: disable eslint for nest src
import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service';
// fixme: disable eslint for nest src
import { parse } from 'url';
import { FileTree } from './teable/file-tree';
@Controller('/')
export class AppController {
  constructor(private appService: AppService) { }

  @Get('*')
  public async home(@Req() req: Request, @Res() res: Response) {
    await this.appService.handler(req, res);
  }

  @Get('_next*')
  public async assets(@Req() req: Request, @Res() res: Response) {
    await this.appService.handler(req, res);
  }

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

  @Get('/teable/schema/:tableId')
  getTableMeta() {
    return {
      success: true,
      data: {},
    };
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
      data: fileTree.getFileContent(filePath),
    };
  }
}
