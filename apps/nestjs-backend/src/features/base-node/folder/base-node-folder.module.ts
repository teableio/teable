import { Module } from '@nestjs/common';
import { BaseNodeFolderController } from './base-node-folder.controller';
import { BaseNodeFolderService } from './base-node-folder.service';

@Module({
  imports: [],
  providers: [BaseNodeFolderService],
  exports: [BaseNodeFolderService],
  controllers: [BaseNodeFolderController],
})
export class BaseNodeFolderModule {}
