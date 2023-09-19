import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guard/auth.guard';

@Controller('api/auth/user')
export class UserController {
  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Request() request: Express.Request) {
    return request.user;
  }
}
