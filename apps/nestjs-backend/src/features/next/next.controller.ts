import { All, Body, Controller, Get, Next, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { IQueryParamsVo } from '@teable/openapi';
import { IQueryParamsRo, queryParamsRoSchema } from '@teable/openapi';
import { NextFunction, Request, Response } from 'express';
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
    'unsubscribe/?*',
    'integrations/authorize/?*',
    't/?*',
  ])
  public async home(@Req() req: Request, @Res() res: Response) {
    await this.nextService.server.getRequestHandler()(req, res);
  }

  /**
   * Dev: proxy SockJS to separate port (SOCKET_PORT) via Next.js rewrites
   * Prod: pass through to let SockJS handle at HTTP server level
   */
  @ApiExcludeEndpoint()
  @Public()
  @All(['socket', 'socket/*'])
  public async socket(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    const isDev = process.env.NODE_ENV === 'development';
    if (!isDev) {
      return next();
    }
    await this.nextService.server.getRequestHandler()(req, res);
  }

  @Post('api/query-params')
  async saveQueryParams(
    @Body(new ZodValidationPipe(queryParamsRoSchema)) saveQueryParamsRo: IQueryParamsRo
  ): Promise<IQueryParamsVo> {
    return await this.nextService.saveQueryParams(saveQueryParamsRo);
  }
}
