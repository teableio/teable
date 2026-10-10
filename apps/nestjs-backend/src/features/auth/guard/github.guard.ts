import { Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';

@Injectable()
export class GithubGuard extends AuthGuard('github') {
  // Nest 12 no longer inherits the AuthGuard mixin's @Optional() constructor marker.
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }
}
