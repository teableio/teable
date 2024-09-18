import { Module } from '@nestjs/common';
import { PluginProxyModule } from './plugin-proxy.module';
@Module({
  imports: [PluginProxyModule],
  providers: [],
  controllers: [],
})
export class NextPluginModule {}
