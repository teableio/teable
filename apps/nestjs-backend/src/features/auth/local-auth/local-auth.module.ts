import { forwardRef, Module } from '@nestjs/common';
import { UserModule } from '../../user/user.module';
import { AuthModule } from '../auth.module';
import { LocalStrategy } from '../strategies/local.strategy';
import { LocalAuthController } from './local-auth.controller';

@Module({
  imports: [UserModule, forwardRef(() => AuthModule)],
  providers: [LocalStrategy],
  controllers: [LocalAuthController],
})
export class LocalAuthModule {}
