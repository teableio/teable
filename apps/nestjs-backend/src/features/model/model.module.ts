import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '@teable/db-main-prisma';
import { AccessTokenModel } from './access-token';
import { CollaboratorModel } from './collaborator';
import { UserModel } from './user';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [UserModel, CollaboratorModel, AccessTokenModel],
  exports: [UserModel, CollaboratorModel, AccessTokenModel],
})
export class ModelModule {}
