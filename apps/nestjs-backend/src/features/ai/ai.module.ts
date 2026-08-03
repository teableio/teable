import { Module } from '@nestjs/common';
import { SettingModule } from '../setting/setting.module';
import { AiGatewayModelsService } from './ai-gateway-models.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [SettingModule],
  controllers: [AiController],
  providers: [AiService, AiGatewayModelsService],
  exports: [AiService, AiGatewayModelsService],
})
export class AiModule {}
