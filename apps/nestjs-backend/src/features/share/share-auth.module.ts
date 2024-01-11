import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { DbProvider } from '../../db-provider/db.provider';
import { AuthGuard } from './guard/auth.guard';
import { ShareAuthService } from './share-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule],
  providers: [JwtStrategy, ShareAuthService, DbProvider, AuthGuard],
  exports: [ShareAuthService, AuthGuard],
})
export class ShareAuthModule {}
