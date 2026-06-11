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

  /**
   * StreamSaver mitm.html needs relaxed CSP to allow inline scripts
   * The default CSP blocks inline scripts which prevents Service Worker registration
   */
  @ApiExcludeEndpoint()
  @Public()
  @Get('streamsaver/mitm.html')
  public async streamSaverMitm(@Req() req: Request, @Res() res: Response) {
    if (!this.nextService.server) {
      return res.status(404).send('Not Found');
    }
    // Allow inline scripts for mitm.html (required for StreamSaver to work)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors *"
    );
    await this.nextService.server.getRequestHandler()(req, res);
  }

  /**
   * Service Worker file needs special headers for registration
   * - Content-Type must be application/javascript
   * - Service-Worker-Allowed header to allow broader scope
   */
  @ApiExcludeEndpoint()
  @Public()
  @Get('streamsaver/sw.js')
  public async serviceWorker(@Req() req: Request, @Res() res: Response) {
    if (!this.nextService.server) {
      return res.status(404).send('Not Found');
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    await this.nextService.server.getRequestHandler()(req, res);
  }

  @ApiExcludeEndpoint()
  @Public()
  @Get([
    '/',
    'favicon.ico',
    '_next/*',
    '__nextjs*',
    'images/*',
    'streamsaver/*',
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

  @ApiExcludeEndpoint()
  @Public()
  @All(['socket', 'socket/*'])
  public async socket(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    if (!this.nextService.server) {
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
