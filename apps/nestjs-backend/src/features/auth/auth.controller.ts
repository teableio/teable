import { Body, Controller, Post, Request, Res, UseGuards } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { AuthSchema } from '@teable-group/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AuthService } from './auth.service';
import { AuthGuard } from './guard/auth.guard';
import { LocalAuthGuard } from './guard/local-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('signin')
  async signin(@Request() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as Prisma.UserGetPayload<null>;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { access_token } = await this.authService.signin(user);
    res.cookie('token', access_token, {
      httpOnly: true,
    });
    return { access_token };
  }

  @UseGuards(AuthGuard)
  @Post('signout')
  async signout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token');
    return null;
  }

  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(AuthSchema.signupSchema)) body: AuthSchema.Signup,
    @Res({ passthrough: true }) res: Response
  ) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { access_token } = await this.authService.signup(body.email, body.password);
    res.cookie('token', access_token);
    return { access_token };
  }
}
