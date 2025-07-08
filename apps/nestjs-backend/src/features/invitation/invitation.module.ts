import { Module } from '@nestjs/common';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { MailSenderModule } from '../mail-sender/mail-sender.module';
import { SettingOpenApiModule } from '../setting/open-api/setting-open-api.module';
import { UserModule } from '../user/user.module';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
  imports: [SettingOpenApiModule, CollaboratorModule, UserModule, MailSenderModule.register()],
  providers: [InvitationService],
  exports: [InvitationService],
  controllers: [InvitationController],
})
export class InvitationModule {}
