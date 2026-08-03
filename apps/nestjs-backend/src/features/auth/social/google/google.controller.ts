import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../decorators/public.decorator';
import { GoogleGuard } from '../../guard/google.guard';
import { SocialGuard } from '../../guard/social.guard';
import { ControllerAdapter } from '../controller.adapter';

@Controller('api/auth')
export class GoogleController extends ControllerAdapter {
  @Get('/google')
  @Public()
  @UseGuards(GoogleGuard)
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async googleAuthenticate() {
    return super.authenticate();
  }

  @Get('/google/callback')
  @Public()
  @UseGuards(SocialGuard, GoogleGuard)
  async googleCallback(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    return super.callback(req, res);
  }
}
