import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { AccessTokenModel } from './access-token';
import { BaseModel } from './base';
import { CollaboratorModel } from './collaborator';
import { SettingModel } from './setting';
import { TemplateModel } from './template';
import { UserModel } from './user';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    UserModel,
    CollaboratorModel,
    AccessTokenModel,
    SettingModel,
    TemplateModel,
    BaseModel,
  ],
  exports: [UserModel, CollaboratorModel, AccessTokenModel, SettingModel, TemplateModel, BaseModel],
})
export class ModelModule {}
