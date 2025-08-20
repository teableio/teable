import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { IQueryParamsVo } from '@teable/openapi';
import { IQueryParamsRo, queryParamsRoSchema } from '@teable/openapi';
import express from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
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
    'waitlist/?*',
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

  @Post('api/query-params')
  async saveQueryParams(
    @Body(new ZodValidationPipe(queryParamsRoSchema)) saveQueryParamsRo: IQueryParamsRo
  ): Promise<IQueryParamsVo> {
    return await this.nextService.saveQueryParams(saveQueryParamsRo);
  }
}
