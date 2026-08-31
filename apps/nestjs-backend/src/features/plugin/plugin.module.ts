import { Module } from '@nestjs/common';
import { AccessTokenModule } from '../access-token/access-token.module';
import { StorageModule } from '../attachments/plugins/storage.module';
import { UserModule } from '../user/user.module';
import { OfficialPluginInitService } from './official/official-plugin-init.service';
import { PluginAuthService } from './plugin-auth.service';
import { PluginController } from './plugin.controller';
import { PluginService } from './plugin.service';

@Module({
  imports: [UserModule, AccessTokenModule, StorageModule],
  providers: [PluginService, PluginAuthService, OfficialPluginInitService],
  controllers: [PluginController],
})
export class PluginModule {}
