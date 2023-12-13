import { Controller, Get, Req, Res, NotFoundException } from '@nestjs/common';
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
    'api/((?!table).)*',
    'space/?*',
    'auth/?*',
    'base/?*',
    'invite/?*',
    'share/?*',
  ])
  public async home(@Req() req: express.Request, @Res() res: express.Response) {
    if (!this.nextService.server) {
      throw new NotFoundException('Next.js server not found');
    }
    await this.nextService.server.getRequestHandler()(req, res);
  }
}
