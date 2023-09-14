import { Module } from '@nestjs/common';
import { SpaceModule } from '../space/space.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  providers: [UserService],
  imports: [SpaceModule],
  exports: [UserService],
  controllers: [UserController],
})
export class UserModule {}
