import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import express from 'express';
import { AppService } from './app.service';

@Controller('/')
export class AppController {
  constructor(private appService: AppService) {}

  @ApiExcludeEndpoint()
  @Get(['/', '_next/*', 'home', '404/*', 'api/((?!table).)*', 'space/?*'])
  public async home(@Req() req: express.Request, @Res() res: express.Response) {
    await this.appService.handler(req, res);
  }
}
