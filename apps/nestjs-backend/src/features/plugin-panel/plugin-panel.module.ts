import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { PluginPanelController } from './plugin-panel.controller';
import { PluginPanelService } from './plugin-panel.service';

@Module({
  imports: [CollaboratorModule, BaseModule],
  controllers: [PluginPanelController],
  exports: [PluginPanelService],
  providers: [PluginPanelService],
})
export class PluginPanelModule {}
