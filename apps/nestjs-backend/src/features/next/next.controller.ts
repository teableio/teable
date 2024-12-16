import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import express from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { NextService } from './next.service';

@Controller('/')
export class NextController {
  constructor(private nextService: NextService) {}

  @ApiExcludeEndpoint()
  @Public()
  @Get([
    '/',
    'favicon.ico',
    '_next/*',
    '__nextjs*',
    'images/*',
    'home',
    '404/*',
    '403/?*',
    '402/?*',
    'space/?*',
    'auth/?*',
    'base/?*',
    'invite/?*',
    'share/?*',
    'setting/?*',
    'admin/?*',
    'oauth/?*',
    'developer/?*',
    'public/?*',
    'enterprise/?*',
  ])
  public async home(@Req() req: express.Request, @Res() res: express.Response) {
    await this.nextService.server.getRequestHandler()(req, res);
  }
}
