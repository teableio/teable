import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { OIDCGuard } from '../../guard/oidc.guard';
import { SocialGuard } from '../../guard/social.guard';
import { ControllerAdapter } from '../controller.adapter';

@Controller('api/auth')
export class OIDCController extends ControllerAdapter {
  @Get('/oidc')
  @Public()
  @UseGuards(OIDCGuard)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async oidcAuthenticate() {
    return super.authenticate();
  }

  @Get('/oidc/callback')
  @Public()
  @UseGuards(SocialGuard, OIDCGuard)
  async oidcCallback(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    return super.callback(req, res);
  }
}
