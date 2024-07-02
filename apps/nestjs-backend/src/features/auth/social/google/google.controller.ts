import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import type { IOauth2State } from '../../../../cache/types';
import { Public } from '../../decorators/public.decorator';
import { GoogleGuard } from '../../guard/google.guard';
import { SocialGuard } from '../../guard/social.guard';

@Controller('api/auth')
export class GoogleController {
  @Get('/google')
  @Public()
  @UseGuards(GoogleGuard)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async googleAuthenticate() {}

  @Get('/google/callback')
  @Public()
  @UseGuards(SocialGuard, GoogleGuard)
  async googleCallback(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user!;
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    const redirectUri = (req.authInfo as { state: IOauth2State })?.state?.redirectUri;
    return res.redirect(redirectUri || '/');
  }
}
