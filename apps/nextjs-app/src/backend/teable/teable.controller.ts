import { parse } from 'url';
import { Controller, Get, Req } from '@nestjs/common';
import { FileTree } from './file-tree';

@Controller('api')
export class TeableController {
  @Get()
  getAll(@Req() req: Request) {
    console.log(req.url, 'x');
    return JSON.stringify({
      hi: '1',
    });
  }

  @Get('fileTree/*')
  getFileTree(@Req() req: Request) {
    console.log('??????');
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;
    const filePath = pathname?.split('/api/fileTree')[1];
    const fileTree = new FileTree(filePath!);
    return JSON.stringify(fileTree.getFiles());
  }

  @Get('teable/schema/:tableId')
  getTableMeta() {
    return {
      success: true,
      data: {},
    };
  }

  @Get('fileContent/*')
  getFileContent(@Req() req: Request) {
    const parsedUrl = parse(req.url, true);
    const { pathname } = parsedUrl;
    const filePath = pathname?.split('/api/fileContent')[1];
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
