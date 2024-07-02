import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import type { IOauth2State } from '../../../../cache/types';
import { Public } from '../../decorators/public.decorator';
import { GithubGuard } from '../../guard/github.guard';
import { SocialGuard } from '../../guard/social.guard';

@Controller('api/auth')
export class GithubController {
  @Get('/github')
  @Public()
  @UseGuards(GithubGuard)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async githubAuthenticate() {}

  @Get('/github/callback')
  @Public()
  @UseGuards(SocialGuard, GithubGuard)
  async githubCallback(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user!;
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    const redirectUri = (req.authInfo as { state: IOauth2State })?.state?.redirectUri;
    return res.redirect(redirectUri || '/');
  }
}
