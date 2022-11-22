// fixme: disable eslint for nest src
import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppService } from './app.service';

@Controller('/')
export class AppController {
  constructor(private appService: AppService) {}

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
}
