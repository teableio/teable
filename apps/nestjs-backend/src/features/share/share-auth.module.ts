import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DbProvider } from '../../db-provider/db.provider';
import { AuthModule } from '../auth/auth.module';
import { V2Module } from '../v2/v2.module';
import { ViewOpenApiV2Service } from '../view/open-api/view-open-api-v2.service';
import { ShareAuthGuard } from './guard/auth.guard';
import { ShareAuthService } from './share-auth.service';
import { SharedViewAccessV2Service } from './shared-view-access-v2.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    AuthModule,
    V2Module,
    // ViewOpenApiV2Service is provided directly (below) instead of importing
    // ViewOpenApiModule: this module sits early in the auth wiring, and pulling
    // a controller-bearing module in here would register community controllers
    // ahead of the EE override controllers, breaking route shadowing.
    PassportModule,
  ],
  providers: [
    JwtStrategy,
    ShareAuthService,
    ViewOpenApiV2Service,
    SharedViewAccessV2Service,
    DbProvider,
    ShareAuthGuard,
  ],
  exports: [ShareAuthService, ShareAuthGuard],
})
export class ShareAuthModule {}
