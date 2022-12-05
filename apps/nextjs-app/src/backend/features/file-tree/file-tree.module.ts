import { Module } from '@nestjs/common';
import { FileTreeController } from './file-tree.controller';

@Module({
  controllers: [FileTreeController],
})
export class FileTreeModule {}
