import { Module } from '@nestjs/common';
import { NextController } from './next.controller';
import { NextService } from './next.service';
import { NextPluginModule } from './plugin/plugin.module';
@Module({
  imports: [NextPluginModule],
  providers: [NextService],
  controllers: [NextController],
})
export class NextModule {}
