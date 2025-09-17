import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { AccessTokenModel } from './access-token';
import { CollaboratorModel } from './collaborator';
import { SettingModel } from './setting';
import { UserModel } from './user';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [UserModel, CollaboratorModel, AccessTokenModel, SettingModel],
  exports: [UserModel, CollaboratorModel, AccessTokenModel, SettingModel],
})
export class ModelModule {}
