import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { DecisionInfoGetVo } from '@teable/openapi';
import { Request, Response } from 'express';
import { EnsureLogin } from '../auth/decorators/ensure-login.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OAuthClientGuard } from './guard/oauth2-client.guard';
import { OAuthServerService } from './oauth-server.service';

@Controller('/api/oauth')
export class OAuthServerController {
  constructor(private readonly oauthServerService: OAuthServerService) {}

  @EnsureLogin()
  @Get('authorize')
  async authorize(@Res({ passthrough: true }) res: Response, @Req() req: Request) {
    await this.oauthServerService.authorize(req, res);
  }

  @Post('access_token')
  @UseGuards(OAuthClientGuard)
  @Public()
  async accessToken(@Res({ passthrough: true }) res: Response, @Req() req: Request) {
    await this.oauthServerService.token(req, res);
  }

  @EnsureLogin()
  @Post('decision')
  async decision(@Res() res: Response, @Req() req: Request) {
    return this.oauthServerService.decision(req, res);
  }

  @Get('decision/:transactionId')
  async transaction(
    @Req() req: Request,
    @Param('transactionId') transactionId: string
  ): Promise<DecisionInfoGetVo> {
    return this.oauthServerService.getDecisionInfo(req, transactionId);
  }
}
