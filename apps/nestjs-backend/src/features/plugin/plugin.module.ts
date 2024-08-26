import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { PluginController } from './plugin.controller';
import { PluginService } from './plugin.service';

@Module({
  imports: [UserModule],
  providers: [PluginService],
  controllers: [PluginController],
})
export class PluginModule {}
