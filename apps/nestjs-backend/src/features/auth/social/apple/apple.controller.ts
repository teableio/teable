import { Controller, Get, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { AppleGuard } from '../../guard/apple.guard';
import { SocialGuard } from '../../guard/social.guard';
import { ControllerAdapter } from '../controller.adapter';
import { AppleAuthExceptionFilter } from './apple-auth-exception.filter';

@Controller('api/auth')
@UseFilters(AppleAuthExceptionFilter)
export class AppleController extends ControllerAdapter {
  @Get('/apple')
  @Public()
  @UseGuards(AppleGuard)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async appleAuthenticate() {
    return super.authenticate();
  }

  /**
   * Unlike the other providers Apple answers with a cross-site form POST
   * (`response_mode=form_post`); the strategy folds the form fields into the query.
   */
  @Post('/apple/callback')
  @Public()
  @UseGuards(SocialGuard, AppleGuard)
  async appleCallback(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return super.callback(req, res, 'apple');
  }
}
