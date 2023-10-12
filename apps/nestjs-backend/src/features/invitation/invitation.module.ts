import { Module } from '@nestjs/common';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { MailSenderModule } from '../mail-sender/mail-sender.module';
import { InvitationService } from './invitation.service';

@Module({
  imports: [MailSenderModule, CollaboratorModule],
  providers: [InvitationService],
  exports: [InvitationService],
})
export class InvitationModule {}
