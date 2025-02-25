import { Module } from '@nestjs/common';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { PluginPanelController } from './plugin-panel.controller';
import { PluginPanelService } from './plugin-panel.service';

@Module({
  imports: [CollaboratorModule],
  controllers: [PluginPanelController],
  providers: [PluginPanelService],
})
export class PluginPanelModule {}
