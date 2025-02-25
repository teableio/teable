import { Module } from '@nestjs/common';
import { CollaboratorModule } from '../collaborator/collaborator.module';
import { PluginContextMenuController } from './plugin-context-menu.controller';
import { PluginContextMenuService } from './plugin-context-menu.service';

@Module({
  imports: [CollaboratorModule],
  controllers: [PluginContextMenuController],
  providers: [PluginContextMenuService],
})
export class PluginContextMenuModule {}
