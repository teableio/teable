import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookFactory } from './webhook.factory';
import { WebhookService } from './webhook.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
    }),
  ],
  controllers: [WebhookController],
  exports: [WebhookService],
  providers: [WebhookService, WebhookFactory],
})
export class WebhookModule {}
