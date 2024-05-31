import { Module } from '@nestjs/common';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { UserModule } from '../user/user.module';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
  imports: [CollaboratorModule, UserModule],
  providers: [InvitationService],
  exports: [InvitationService],
  controllers: [InvitationController],
})
export class InvitationModule {}
