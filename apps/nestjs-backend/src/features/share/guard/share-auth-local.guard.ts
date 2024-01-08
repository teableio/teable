import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ShareAuthService } from '../share-auth.service';

@Injectable()
export class ShareAuthLocalGuard implements CanActivate {
  constructor(private readonly shareAuthService: ShareAuthService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const shareId = req.params.shareId;
    const password = req.body.password;
    const authShareId = await this.shareAuthService.authShareView(shareId, password);
    req.shareId = authShareId;
    req.password = password;
    if (!authShareId) {
      throw new BadRequestException('Incorrect password.');
    }
    return true;
  }
}
