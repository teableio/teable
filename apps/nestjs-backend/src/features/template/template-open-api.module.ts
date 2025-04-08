import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { BaseModule } from '../base/base.module';
import { TemplateOpenApiController } from './template-open-api.controller';
import { TemplateOpenApiService } from './template-open-api.service';

@Module({
  imports: [BaseModule, AttachmentsStorageModule],
  controllers: [TemplateOpenApiController],
  providers: [TemplateOpenApiService],
  exports: [TemplateOpenApiService],
})
export class TemplateOpenApiModule {}
