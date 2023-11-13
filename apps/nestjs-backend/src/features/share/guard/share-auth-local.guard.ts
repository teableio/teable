import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ShareService } from '../share.service';

@Injectable()
export class ShareAuthLocalGuard implements CanActivate {
  constructor(private readonly shareService: ShareService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const shareId = req.params.shareId;
    const password = req.body.password;
    const authShareId = await this.shareService.authShareView(shareId, password);
    req.shareId = authShareId;
    if (!authShareId) {
      throw new BadRequestException('Incorrect password.');
    }
    return true;
  }
}
