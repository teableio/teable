import { Controller, Get, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { GithubGuard } from '../../guard/github.guard';
import { SocialGuard } from '../../guard/social.guard';
import { AppSignupUnavailableFilter } from '../app-signup-unavailable.filter';
import { ControllerAdapter } from '../controller.adapter';

@Controller('api/auth')
@UseFilters(AppSignupUnavailableFilter)
export class GithubController extends ControllerAdapter {
  @Get('/github')
  @Public()
  @UseGuards(GithubGuard)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async githubAuthenticate() {
    return super.authenticate();
  }

  @Get('/github/callback')
  @Public()
  @UseGuards(SocialGuard, GithubGuard)
  async githubCallback(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    return super.callback(req, res, 'github');
  }
}
