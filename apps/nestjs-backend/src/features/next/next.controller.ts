import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import express from 'express';
import { NextService } from './next.service';

@Controller('/')
export class NextController {
  constructor(private nextService: NextService) {}

  @ApiExcludeEndpoint()
  @Get([
    '/',
    'favicon.ico',
    '_next/*',
    'images/*',
    'home',
    '404/*',
    'api/((?!table).)*',
    'space/?*',
  ])
  public async home(@Req() req: express.Request, @Res() res: express.Response) {
    await this.nextService.server.getRequestHandler()(req, res);
  }
}
